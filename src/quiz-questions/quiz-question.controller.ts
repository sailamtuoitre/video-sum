import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateQuizQuestionDto } from './dto/create-quiz-question.dto';
import { CheckQuizQuestionAnswerDto } from './dto/check-quiz-question-answer.dto';
import { UpdateQuizQuestionDto } from './dto/update-quiz-question.dto';
import { QuizQuestionService } from './quiz-question.service';

@Controller('quiz-questions')
export class QuizQuestionController {
  constructor(private readonly quizQuestionService: QuizQuestionService) {}

  @Post()
  create(@Body() createQuizQuestionDto: CreateQuizQuestionDto) {
    return this.quizQuestionService.create(createQuizQuestionDto);
  }

  @Post(':id/check-answer')
  checkAnswer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() answerDto: CheckQuizQuestionAnswerDto,
  ) {
    return this.quizQuestionService.checkAnswer(id, answerDto);
  }

  @Get()
  findAll(@Query('quizId') quizId?: string) {
    return this.quizQuestionService.findAll(quizId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.quizQuestionService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateQuizQuestionDto: UpdateQuizQuestionDto,
  ) {
    return this.quizQuestionService.update(id, updateQuizQuestionDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.quizQuestionService.remove(id);
  }
}
