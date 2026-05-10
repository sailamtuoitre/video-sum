import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatSessionModule } from './chat-sessions/chat-session.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectModule } from './projects/project.module';
import { VideoModule } from './video/video.module';
import { RagModule } from './rag/rag.module';
import { SummaryModule } from './summaries/summary.module';
import { QuizModule } from './quizzes/quiz.module';
import { QuizQuestionModule } from './quiz-questions/quiz-question.module';
import { ChunkModule } from './chunks/chunk.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    VideoModule,
    ProjectModule,
    ChatSessionModule,
    ChunkModule,
    SummaryModule,
    QuizModule,
    QuizQuestionModule,
    RagModule,
  ],
})
export class AppModule {}
