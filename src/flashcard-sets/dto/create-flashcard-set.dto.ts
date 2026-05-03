import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFlashcardSetDto {
  @IsUUID()
  videoId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalCards?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelUsed?: string;
}
