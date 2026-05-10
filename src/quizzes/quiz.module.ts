import { Module } from '@nestjs/common';
import { SummaryModule } from '../summaries/summary.module';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';

@Module({
  imports: [SummaryModule],
  controllers: [QuizController],
  providers: [QuizService],
})
export class QuizModule {}
