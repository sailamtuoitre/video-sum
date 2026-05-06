import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { exec } from 'child_process';
import { unlinkSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);
  private readonly transcriptionEndpoint =
    'https://api.groq.com/openai/v1/audio/transcriptions';
  private readonly retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);

  async transcribeFromYoutube(youtubeId: string): Promise<string> {
    const audioPath = await this.downloadAudio(youtubeId);

    try {
      const transcript = await this.transcribe(audioPath);
      return transcript;
    } finally {
      if (existsSync(audioPath)) {
        unlinkSync(audioPath);
      }
    }
  }

  async transcribe(filePath: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'GROQ_API_KEY is required to use Groq transcription',
      );
    }

    const transcript = await this.transcribeWithRetry(filePath, apiKey);

    if (!transcript.trim()) {
      throw new ServiceUnavailableException({
        message: 'Groq transcription returned empty text',
      });
    }

    return transcript;
  }

  private async transcribeWithRetry(filePath: string, apiKey: string) {
    const maxAttempts = 3;
    let lastErrorMessage = 'Groq transcription failed';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.requestTranscription(filePath, apiKey);

        if (!response.ok) {
          const errorText = await response.text();
          const summarizedError = this.summarizeHttpError(
            response.status,
            errorText,
          );

          if (
            attempt < maxAttempts &&
            this.retryableStatuses.has(response.status)
          ) {
            this.logger.warn(
              `Groq transcription attempt ${attempt}/${maxAttempts} failed: ${summarizedError}. Retrying...`,
            );
            await this.delay(attempt * 1500);
            lastErrorMessage = summarizedError;
            continue;
          }

          this.logger.error(
            `Groq transcription failed after ${attempt} attempt(s): ${summarizedError}`,
          );
          throw new ServiceUnavailableException(summarizedError);
        }

        return await response.text();
      } catch (error) {
        const message = this.extractErrorMessage(error);

        if (attempt < maxAttempts) {
          this.logger.warn(
            `Groq transcription attempt ${attempt}/${maxAttempts} threw: ${message}. Retrying...`,
          );
          await this.delay(attempt * 1500);
          lastErrorMessage = message;
          continue;
        }

        this.logger.error(
          `Groq transcription failed after ${attempt} attempt(s): ${message}`,
        );

        if (error instanceof ServiceUnavailableException) {
          throw error;
        }

        throw new ServiceUnavailableException(
          `Groq transcription unavailable: ${message}`,
        );
      }
    }

    throw new ServiceUnavailableException(lastErrorMessage);
  }

  private async requestTranscription(filePath: string, apiKey: string) {
    const formData = new FormData();
    const audioBuffer = readFileSync(filePath);
    const audioFile = new Blob([audioBuffer], { type: 'audio/mpeg' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    formData.append('file', audioFile, 'audio.mp3');
    formData.append(
      'model',
      process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
    );
    formData.append('response_format', 'text');

    try {
      return await fetch(this.transcriptionEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private summarizeHttpError(status: number, errorText: string) {
    const normalized = errorText
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return `Groq transcription failed with HTTP ${status}`;
    }

    return `Groq transcription failed with HTTP ${status}: ${normalized}`;
  }

  private extractErrorMessage(error: unknown) {
    if (error instanceof ServiceUnavailableException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }

      if (
        response &&
        typeof response === 'object' &&
        'message' in response &&
        typeof response.message === 'string'
      ) {
        return response.message;
      }
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return 'request timed out';
      }

      return error.message;
    }

    return 'unknown error';
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async downloadAudio(youtubeId: string): Promise<string> {
    const outputPath = join(process.cwd(), 'temp_audio');
    const outputTemplate = join(outputPath, `${youtubeId}.mp3`);

    if (existsSync(outputTemplate)) {
      return outputTemplate;
    }

    try {
      this.logger.log(`Downloading audio for ${youtubeId}...`);

      await execAsync(
        `yt-dlp -f "bestaudio[ext=m4a]/bestaudio" --extract-audio --audio-format mp3 --audio-quality 0 -o "${outputTemplate}" "https://www.youtube.com/watch?v=${youtubeId}" --no-playlist`,
        { timeout: 120_000 },
      );

      return outputTemplate;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'yt-dlp failed';
      this.logger.error(`Audio download failed: ${message}`);
      throw new Error(
        `Failed to download YouTube audio. Is yt-dlp installed? ${message}`,
      );
    }
  }
}
