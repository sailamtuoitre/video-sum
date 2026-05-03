import { Module } from '@nestjs/common';
import { ChunkModule } from './chunk/chunk.module';
import { PrismaModule } from './prisma/prisma.module';
import { TranscriptModule } from './transcript/transcript.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [PrismaModule, VideoModule, TranscriptModule, ChunkModule],
})
export class AppModule {}
