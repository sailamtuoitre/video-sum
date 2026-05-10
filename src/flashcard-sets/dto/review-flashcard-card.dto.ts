import { IsIn, IsUUID } from 'class-validator';

export class ReviewFlashcardCardDto {
  @IsUUID()
  flashcardId: string;

  @IsIn(['known', 'unknown'])
  status: 'known' | 'unknown';
}
