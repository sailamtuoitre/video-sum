import {
  Injectable,
  Logger,
} from '@nestjs/common';
// import { exec } from 'child_process';
// import { promisify } from 'util';
import { GroqGatewayService } from '../groq-gateway/groq-gateway.service';
import { fetchTranscript, TranscriptResponse } from 'youtube-transcript';

// const execAsync = promisify(exec);

@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);

  constructor(private readonly groqGateway: GroqGatewayService) {}

  async fetchYoutubeTranscript(youtubeId: string): Promise<TranscriptResponse[]> {
    try {
      const transcript = await fetchTranscript(youtubeId);
      
      return transcript;
    } catch (e) {
      console.log('WhisperService ~ transcribeFromYoutube ~ e:', e);
      return []
    }
  }
}
