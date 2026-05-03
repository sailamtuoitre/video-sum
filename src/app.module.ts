import { Module } from '@nestjs/common';
import { ChunkModule } from './chunks/chunk.module';
import { PrismaModule } from './prisma/prisma.module';
import { SummaryModule } from './summaries/summary.module';
import { TranscriptModule } from './transcript/transcript.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    PrismaModule,
    VideoModule,
    TranscriptModule,
    ChunkModule,
    SummaryModule,
  ],
})
export class AppModule {}
