import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessageChunk } from '@langchain/core/messages';
import { SummaryConfig } from './summary.types';

@Injectable()
export class LlmInvoker {
  private readonly logger = new Logger(LlmInvoker.name);

  createLlm(
    modelName: string,
    groqApiKey: string,
    maxTokens: number,
    config: SummaryConfig,
  ) {
    return new ChatOpenAI({
      model: modelName,
      apiKey: groqApiKey,
      configuration: {
        baseURL: config.baseUrl,
      },
      temperature: 0.1,
      maxTokens,
    });
  }

  invokeJsonLlm(
    llm: ChatOpenAI,
    prompt: string,
  ): Promise<AIMessageChunk> {
    return llm.invoke(prompt, {
      response_format: {
        type: 'json_object',
      },
    });
  }

  async invokeLlmWithRetry<T>(
    invoke: () => Promise<T>,
    config: SummaryConfig,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= config.retryAttempts; attempt += 1) {
      try {
        return await invoke();
      } catch (error) {
        lastError = error;

        if (
          attempt >= config.retryAttempts ||
          !this.isRetryableLlmError(error)
        ) {
          throw error;
        }

        const delayMs = this.getRetryDelayMs(error, attempt, config);
        this.logger.warn(
          `Summary AI rate limited. Retrying in ${delayMs}ms ` +
            `(attempt ${attempt + 1}/${config.retryAttempts}).`,
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private isRetryableLlmError(error: unknown): boolean {
    const record = this.toErrorRecord(error);
    const status = record?.status;
    const code = record?.code;
    const lcErrorCode = record?.lc_error_code;

    return (
      status === 429 ||
      code === 'rate_limit_exceeded' ||
      lcErrorCode === 'MODEL_RATE_LIMIT'
    );
  }

  private getRetryDelayMs(
    error: unknown,
    attempt: number,
    config: SummaryConfig,
  ): number {
    const retryAfterMs = this.getRetryAfterMs(error);

    if (retryAfterMs !== null) {
      return retryAfterMs;
    }

    return config.retryBaseDelayMs * 2 ** attempt;
  }

  private getRetryAfterMs(error: unknown): number | null {
    const headers = this.toErrorRecord(error)?.headers;

    if (!headers || typeof headers !== 'object' || !('get' in headers)) {
      return null;
    }

    const getHeader = headers.get;

    if (typeof getHeader !== 'function') {
      return null;
    }

    const retryAfter = getHeader.call(headers, 'retry-after') as unknown;

    if (typeof retryAfter !== 'string') {
      return null;
    }

    const seconds = Number.parseFloat(retryAfter);

    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }

    return Math.ceil(seconds * 1000);
  }

  private toErrorRecord(error: unknown): Record<string, unknown> | null {
    if (typeof error !== 'object' || error === null) {
      return null;
    }

    return error as Record<string, unknown>;
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
