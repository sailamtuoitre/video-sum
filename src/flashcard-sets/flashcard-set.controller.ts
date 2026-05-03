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
import { CreateFlashcardSetDto } from './dto/create-flashcard-set.dto';
import { UpdateFlashcardSetDto } from './dto/update-flashcard-set.dto';
import { FlashcardSetService } from './flashcard-set.service';

@Controller('flashcard-sets')
export class FlashcardSetController {
  constructor(private readonly flashcardSetService: FlashcardSetService) {}

  @Post()
  create(@Body() createFlashcardSetDto: CreateFlashcardSetDto) {
    return this.flashcardSetService.create(createFlashcardSetDto);
  }

  @Get()
  findAll(@Query('videoId') videoId?: string) {
    return this.flashcardSetService.findAll(videoId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.flashcardSetService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateFlashcardSetDto: UpdateFlashcardSetDto,
  ) {
    return this.flashcardSetService.update(id, updateFlashcardSetDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.flashcardSetService.remove(id);
  }
}
