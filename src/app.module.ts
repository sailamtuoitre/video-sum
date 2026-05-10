import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatMessageModule } from './chat-messages/chat-message.module';
import { ChatSessionModule } from './chat-sessions/chat-session.module';
import { ChunkModule } from './chunks/chunk.module';
import { FlashcardSetModule } from './flashcard-sets/flashcard-set.module';
import { GroqGatewayModule } from './groq-gateway/groq-gateway.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectModule } from './projects/project.module';
import { QuizModule } from './quizzes/quiz.module';
import { QuizQuestionModule } from './quiz-questions/quiz-question.module';
import { SummaryModule } from './summaries/summary.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GroqGatewayModule,
    PrismaModule,
    VideoModule,
    ChunkModule,
    SummaryModule,
    QuizModule,
    QuizQuestionModule,
    FlashcardSetModule,
    ProjectModule,
    ChatSessionModule,
    ChatMessageModule,
  ],
})
export class AppModule {}
