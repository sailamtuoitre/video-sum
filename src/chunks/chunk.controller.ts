import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ChunkService } from './chunk.service';

@Controller('chunks')
export class ChunkController {
  constructor(private readonly chunkService: ChunkService) {}

  @Post('preview')
  preview(@Body() input: unknown) {
    const text = this.chunkService.normalizePreviewInput(input);
    return this.chunkService.previewTranscriptChunks(text);
  }

  @Post('from-video/:videoId')
  createFromVideo(@Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.chunkService.createFromVideo(videoId);
  }

  @Get()
  findAll(
    @Query('videoId') videoId?: string,
    @Query('transcriptId') transcriptId?: string,
  ) {
    return this.chunkService.findAll(videoId, transcriptId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.chunkService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.chunkService.remove(id);
  }
}
