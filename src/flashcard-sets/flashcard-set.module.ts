import { Module } from '@nestjs/common';
import { FlashcardSetController } from './flashcard-set.controller';
import { FlashcardSetService } from './flashcard-set.service';

@Module({
  controllers: [FlashcardSetController],
  providers: [FlashcardSetService],
})
export class FlashcardSetModule {}
