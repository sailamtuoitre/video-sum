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
import { ChunkService } from './chunk.service';
import { CreateChunkDto } from './dto/create-chunk.dto';
import { UpdateChunkDto } from './dto/update-chunk.dto';

@Controller('chunks')
export class ChunkController {
  constructor(private readonly chunkService: ChunkService) {}

  @Post()
  create(@Body() createChunkDto: CreateChunkDto) {
    return this.chunkService.create(createChunkDto);
  }

  @Post('preview')
  preview(@Body() previewChunkInput: unknown) {
    const normalizedText =
      this.chunkService.normalizeChunkPreviewInput(previewChunkInput);
    return this.chunkService.previewTranscriptChunks(normalizedText);
  }

  @Post('from-video/:videoId')
  previewFromVideo(@Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.chunkService.previewChunksFromVideo(videoId);
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

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateChunkDto: UpdateChunkDto,
  ) {
    return this.chunkService.update(id, updateChunkDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.chunkService.remove(id);
  }
}
