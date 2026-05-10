import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ReviewFlashcardCardDto } from './dto/review-flashcard-card.dto';
import { FlashcardSetService } from './flashcard-set.service';

@Controller('flashcard-sets')
export class FlashcardSetController {
  constructor(private readonly flashcardSetService: FlashcardSetService) {}

  @Post('from-video/:videoId')
  createFromVideo(@Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.flashcardSetService.createFromVideo(videoId);
  }

  @Post('from-project/:projectId')
  createFromProject(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.flashcardSetService.createFromProject(projectId);
  }

  @Get(':id/study')
  getStudyState(@Param('id', ParseUUIDPipe) id: string) {
    return this.flashcardSetService.getStudyState(id);
  }

  @Post(':id/study/review')
  reviewCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() reviewFlashcardCardDto: ReviewFlashcardCardDto,
  ) {
    return this.flashcardSetService.reviewCard(id, reviewFlashcardCardDto);
  }

  @Post(':id/study/reset')
  resetStudy(@Param('id', ParseUUIDPipe) id: string) {
    return this.flashcardSetService.resetStudy(id);
  }

  @Get()
  findAll(
    @Query('videoId') videoId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.flashcardSetService.findAll(videoId, projectId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.flashcardSetService.findOne(id);
  }
}
