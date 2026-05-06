import { Module } from '@nestjs/common';
import { WhisperModule } from '../whisper/whisper.module';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';

@Module({
  imports: [WhisperModule],
  controllers: [VideoController],
  providers: [VideoService],
})
export class VideoModule {}
