import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { exec } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { GroqGatewayService } from '../groq-gateway/groq-gateway.service';

const execAsync = promisify(exec);

@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);

  constructor(private readonly groqGateway: GroqGatewayService) {}

  async transcribeFromYoutube(youtubeId: string): Promise<string> {
    const audioPath = await this.downloadAudio(youtubeId);

    try {
      return await this.transcribe(audioPath);
    } finally {
      if (existsSync(audioPath)) {
        unlinkSync(audioPath);
      }
    }
  }

  async transcribe(filePath: string): Promise<string> {
    if (!this.groqGateway.hasKeys()) {
      throw new ServiceUnavailableException(
        'GROQ_API_KEY or GROQ_API_KEYS is required to use Groq transcription',
      );
    }

    const transcript = await this.groqGateway.transcribe(filePath);

    if (!transcript || !transcript.trim()) {
      throw new ServiceUnavailableException({
        message: 'Groq transcription returned empty text',
      });
    }

    return transcript;
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
      const message = error instanceof Error ? error.message : 'yt-dlp failed';
      this.logger.error(`Audio download failed: ${message}`);
      throw new Error(
        `Failed to download YouTube audio. Is yt-dlp installed? ${message}`,
      );
    }
  }
}
