import { Module } from '@nestjs/common';
import { ChunkModule } from './chunks/chunk.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuizModule } from './quizzes/quiz.module';
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
    QuizModule,
  ],
})
export class AppModule {}
