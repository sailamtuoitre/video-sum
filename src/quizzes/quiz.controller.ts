import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { QuizService } from './quiz.service';

@Controller('quizzes')
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Post('from-video/:videoId')
  createFromVideo(@Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.quizService.createFromVideo(videoId);
  }

  @Get()
  findAll(@Query('videoId') videoId?: string) {
    return this.quizService.findAll(videoId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.quizService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.quizService.remove(id);
  }
}
