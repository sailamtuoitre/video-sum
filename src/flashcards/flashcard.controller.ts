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
import { CreateFlashcardDto } from './dto/create-flashcard.dto';
import { UpdateFlashcardDto } from './dto/update-flashcard.dto';
import { FlashcardService } from './flashcard.service';

@Controller('flashcards')
export class FlashcardController {
  constructor(private readonly flashcardService: FlashcardService) {}

  @Post()
  create(@Body() createFlashcardDto: CreateFlashcardDto) {
    return this.flashcardService.create(createFlashcardDto);
  }

  @Get()
  findAll(@Query('setId') setId?: string) {
    return this.flashcardService.findAll(setId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.flashcardService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateFlashcardDto: UpdateFlashcardDto,
  ) {
    return this.flashcardService.update(id, updateFlashcardDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.flashcardService.remove(id);
  }
}
