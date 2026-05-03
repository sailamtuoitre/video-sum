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
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import { UpdateTranscriptDto } from './dto/update-transcript.dto';
import { TranscriptService } from './transcript.service';

@Controller('transcripts')
export class TranscriptController {
  constructor(private readonly transcriptService: TranscriptService) {}

  @Post()
  create(@Body() createTranscriptDto: CreateTranscriptDto) {
    return this.transcriptService.create(createTranscriptDto);
  }

  @Get()
  findAll(@Query('videoId') videoId?: string) {
    return this.transcriptService.findAll(videoId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.transcriptService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTranscriptDto: UpdateTranscriptDto,
  ) {
    return this.transcriptService.update(id, updateTranscriptDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.transcriptService.remove(id);
  }
}
