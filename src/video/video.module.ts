import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';

@Module({
  imports: [RagModule],
  controllers: [VideoController],
  providers: [VideoService],
})
export class VideoModule {}
