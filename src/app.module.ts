import { Module } from '@nestjs/common';
import { ChunkModule } from './chunks/chunk.module';
import { FlashcardSetModule } from './flashcard-sets/flashcard-set.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuizModule } from './quizzes/quiz.module';
import { QuizQuestionModule } from './quiz-questions/quiz-question.module';
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
    QuizQuestionModule,
    FlashcardSetModule,
  ],
})
export class AppModule {}
