import { Module } from '@nestjs/common';
import { ChunkModule } from '../chunks/chunk.module';
import { SummaryModule } from '../summaries/summary.module';
import { FlashcardSetController } from './flashcard-set.controller';
import { FlashcardSetService } from './flashcard-set.service';

@Module({
  imports: [ChunkModule, SummaryModule],
  controllers: [FlashcardSetController],
  providers: [FlashcardSetService],
})
export class FlashcardSetModule {}
