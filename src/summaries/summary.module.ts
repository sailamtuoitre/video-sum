import { Module } from '@nestjs/common';
import { ChunkModule } from '../chunks/chunk.module';
import { SummaryConfigService } from './summary-config.service';
import { SummaryController } from './summary.controller';
import { SummaryPromptBuilder } from './summary-prompt.builder';
import { SummaryService } from './summary.service';
import { SummaryTextService } from './summary-text.service';
import { LlmJsonParser } from './llm-json-parser.service';
import { SummaryQualityChecker } from './summary-quality-checker.service';
import { LlmInvoker } from './llm-invoker.service';
import { ChunkSelector } from './chunk-selector.service';

@Module({
  imports: [ChunkModule],
  controllers: [SummaryController],
  providers: [
    SummaryService,
    SummaryConfigService,
    SummaryPromptBuilder,
    SummaryTextService,
    LlmJsonParser,
    SummaryQualityChecker,
    LlmInvoker,
    ChunkSelector,
  ],
  exports: [SummaryService],
})
export class SummaryModule {}
