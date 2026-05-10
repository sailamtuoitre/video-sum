import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import {
  ChatCompletionParams,
  ChatCompletionResult,
  GroqChatResponse,
  GroqErrorPayload,
} from './groq-gateway.types';

type KeyEntry = {
  key: string;
  cooldownUntil: number;
};

const CHAT_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const TRANSCRIPTION_ENDPOINT =
  'https://api.groq.com/openai/v1/audio/transcriptions';
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RATE_LIMIT_COOLDOWN_MS = 60_000;

@Injectable()
export class GroqGatewayService {
  private readonly logger = new Logger(GroqGatewayService.name);
  private readonly keys: KeyEntry[];
  private nextKeyIndex = 0;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('GROQ_API_KEYS')?.trim();
    if (raw) {
      this.keys = raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .map((key) => ({ key, cooldownUntil: 0 }));
    } else {
      const single = this.configService.get<string>('GROQ_API_KEY')?.trim();
      if (single) {
        this.keys = [{ key: single, cooldownUntil: 0 }];
      } else {
        this.keys = [];
      }
    }
  }

  hasKeys() {
    return this.keys.length > 0;
  }

  async chatCompletion(
    params: ChatCompletionParams,
  ): Promise<ChatCompletionResult | null> {
    const primary = params.model?.trim();
    const fallbacks = params.fallbackModels ?? [];
    const allModels = [primary, ...fallbacks].filter(Boolean) as string[];

    const uniqueModels = [...new Set(allModels)];

    for (const model of uniqueModels) {
      const result = await this.tryModelWithKeyRotation(params, model);
      if (result) {
        return result;
      }
    }

    return null;
  }

  async transcribe(
    filePath: string,
    model?: string,
    maxRetries?: number,
  ): Promise<string | null> {
    const whisperModel =
      model?.trim() ||
      this.configService.get<string>('GROQ_WHISPER_MODEL') ||
      'whisper-large-v3-turbo';

    if (!this.hasKeys()) {
      this.logger.warn('No Groq API keys configured for transcription');
      return null;
    }

    const maxAttempts = maxRetries ?? 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const apiKey = this.getAvailableKey();
      if (!apiKey) {
        this.logger.warn(
          `All Groq API keys in cooldown during transcription attempt ${attempt}`,
        );
        await this.delay(2000);
        continue;
      }

      try {
        const audioBuffer = readFileSync(filePath);
        const audioFile = new Blob([audioBuffer], { type: 'audio/mpeg' });
        const formData = new FormData();
        formData.append('file', audioFile, 'audio.mp3');
        formData.append('model', whisperModel);
        formData.append('response_format', 'text');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90_000);

        try {
          const response = await fetch(TRANSCRIPTION_ENDPOINT, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: formData,
            signal: controller.signal,
          });

          if (response.ok) {
            const text = await response.text();
            if (text.trim()) {
              return text;
            }
            this.logger.warn(
              `Transcription returned empty text on attempt ${attempt}`,
            );
            continue;
          }

          const errorText = await response.text();
          const summarized = this.summarizeError(
            response.status,
            errorText,
          );

          if (response.status === 429) {
            this.setKeyCooldown(apiKey);
          }

          if (
            attempt < maxAttempts &&
            RETRYABLE_STATUSES.has(response.status)
          ) {
            this.logger.warn(
              `Transcription attempt ${attempt}/${maxAttempts} failed: ${summarized}. Retrying...`,
            );
            await this.delay(attempt * 1500);
            continue;
          }

          this.logger.error(
            `Transcription failed after ${attempt} attempt(s): ${summarized}`,
          );
          return null;
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        const message = this.extractErrorMessage(error);

        if (attempt < maxAttempts) {
          this.logger.warn(
            `Transcription attempt ${attempt}/${maxAttempts} threw: ${message}. Retrying...`,
          );
          await this.delay(attempt * 1500);
          continue;
        }

        this.logger.error(
          `Transcription failed after ${attempt} attempt(s): ${message}`,
        );
        return null;
      }
    }

    return null;
  }

  private async tryModelWithKeyRotation(
    params: ChatCompletionParams,
    model: string,
  ): Promise<ChatCompletionResult | null> {
    const maxRetries = params.maxRetriesPerModel ?? 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const apiKey = this.getAvailableKey();
      if (!apiKey) {
        this.logger.warn(
          `All Groq keys in cooldown for model ${model}, waiting...`,
        );
        await this.delay(3000);
        continue;
      }

      try {
        const endpoint =
          this.configService.get<string>(
            'GROQ_CHAT_COMPLETIONS_ENDPOINT',
          ) || CHAT_ENDPOINT;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: params.temperature ?? 0.2,
            max_tokens: params.maxTokens ?? 3200,
            messages: params.messages,
          }),
        });

        if (response.ok) {
          const payload = (await response.json()) as GroqChatResponse;
          const content = payload.choices?.[0]?.message?.content;
          if (content) {
            return {
              content: content.trim(),
              modelUsed: model,
              promptTokens: payload.usage?.prompt_tokens ?? null,
              completionTokens: payload.usage?.completion_tokens ?? null,
            };
          }
          this.logger.warn(
            `Empty response content from model ${model} on attempt ${attempt}`,
          );
          continue;
        }

        const errorText = await response.text();
        const summarized = this.summarizeError(response.status, errorText);

        if (response.status === 429) {
          this.setKeyCooldown(apiKey);
        }

        if (this.isDecommissionedError(response.status, errorText)) {
          this.logger.warn(
            `Model ${model} is decommissioned: ${summarized}`,
          );
          return null;
        }

        if (
          attempt < maxRetries &&
          RETRYABLE_STATUSES.has(response.status)
        ) {
          this.logger.warn(
            `Chat completion attempt ${attempt}/${maxRetries} failed with model ${model}: ${summarized}. Retrying...`,
          );
          await this.delay(attempt * 1500);
          continue;
        }

        this.logger.warn(
          `Chat completion failed with model ${model}: ${summarized}`,
        );
        return null;
      } catch (error) {
        const message = this.extractErrorMessage(error);

        if (attempt < maxRetries) {
          this.logger.warn(
            `Chat completion attempt ${attempt}/${maxRetries} threw with model ${model}: ${message}. Retrying...`,
          );
          await this.delay(attempt * 1500);
          continue;
        }

        this.logger.warn(
          `Chat completion failed with model ${model}: ${message}`,
        );
        return null;
      }
    }

    return null;
  }

  private getAvailableKey(): string | null {
    if (this.keys.length === 0) {
      return null;
    }

    const now = Date.now();
    const start = this.nextKeyIndex;

    for (let i = 0; i < this.keys.length; i++) {
      const idx = (start + i) % this.keys.length;
      const entry = this.keys[idx];
      if (entry.cooldownUntil <= now) {
        this.nextKeyIndex = (idx + 1) % this.keys.length;
        return entry.key;
      }
    }

    const minCooldown = Math.min(...this.keys.map((k) => k.cooldownUntil));
    const remaining = Math.max(0, minCooldown - now);

    if (remaining > 30_000) {
      for (const entry of this.keys) {
        entry.cooldownUntil = 0;
      }
      this.logger.warn('All keys were in extended cooldown, resetting all');
      this.nextKeyIndex = 0;
      return this.keys[0].key;
    }

    return null;
  }

  private setKeyCooldown(key: string) {
    const entry = this.keys.find((k) => k.key === key);
    if (entry) {
      entry.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      this.logger.warn(`Placed Groq API key on 60s cooldown after rate limit`);
    }
  }

  private isDecommissionedError(status: number, errorText: string): boolean {
    if (status !== 400) {
      return false;
    }

    try {
      const payload = JSON.parse(errorText) as GroqErrorPayload;
      const code = payload?.error?.code;
      if (code === 'model_decommissioned') {
        return true;
      }
      const message = payload?.error?.message ?? '';
      return (
        message.includes('decommissioned') ||
        message.includes('model_decommissioned')
      );
    } catch {
      return false;
    }
  }

  private summarizeError(status: number, errorText: string): string {
    const normalized = errorText.replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!normalized) {
      return `HTTP ${status}`;
    }
    return `HTTP ${status}: ${normalized}`;
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return 'request timed out';
      }
      return String(error.message);
    }
    return 'unknown error';
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
