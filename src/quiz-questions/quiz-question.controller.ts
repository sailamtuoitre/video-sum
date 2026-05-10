import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CheckQuizQuestionAnswerDto } from './dto/check-quiz-question-answer.dto';
import { QuizQuestionService } from './quiz-question.service';

@Controller('quiz-questions')
export class QuizQuestionController {
  constructor(private readonly quizQuestionService: QuizQuestionService) {}

  @Post(':id/check-answer')
  checkAnswer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() answerDto: CheckQuizQuestionAnswerDto,
  ) {
    return this.quizQuestionService.checkAnswer(id, answerDto);
  }
}
