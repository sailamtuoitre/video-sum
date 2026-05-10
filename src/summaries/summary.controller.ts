import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { SummaryService } from './summary.service';

@Controller('summaries')
export class SummaryController {
  constructor(private readonly summaryService: SummaryService) {}

  @Get()
  findAll(@Query('videoId') videoId?: string) {
    return this.summaryService.findAll(videoId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.summaryService.findOne(id);
  }

  @Post('from-video/:videoId')
  createFromVideo(@Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.summaryService.createFromVideo(videoId);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.summaryService.remove(id);
  }
}
