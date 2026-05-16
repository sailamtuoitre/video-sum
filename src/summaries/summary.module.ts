import { Module } from '@nestjs/common';
import { ChunkModule } from '../chunks/chunk.module';
import { SummaryConfigService } from './summary-config.service';
import { SummaryController } from './summary.controller';
import { SummaryPromptBuilder } from './summary-prompt.builder';
import { SummaryService } from './summary.service';
import { SummaryTextService } from './summary-text.service';

@Module({
  imports: [ChunkModule],
  controllers: [SummaryController],
  providers: [
    SummaryService,
    SummaryConfigService,
    SummaryPromptBuilder,
    SummaryTextService,
  ],
  exports: [SummaryService],
})
export class SummaryModule {}
