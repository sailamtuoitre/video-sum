import { Module } from '@nestjs/common';
import { ChunkModule } from '../chunks/chunk.module';
import { WhisperModule } from '../whisper/whisper.module';
import { SummaryModule } from '../summaries/summary.module';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';

@Module({
  imports: [WhisperModule, ChunkModule, SummaryModule],
  controllers: [VideoController],
  providers: [VideoService],
})
export class VideoModule {}
