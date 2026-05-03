import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateQuizDto {
  @IsUUID()
  videoId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalQuestions?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelUsed?: string;
}
