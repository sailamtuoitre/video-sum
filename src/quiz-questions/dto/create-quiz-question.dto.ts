import {
  IsInt,
  IsJSON,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class CreateQuizQuestionDto {
  @IsUUID()
  quizId: string;

  @IsString()
  questionText: string;

  @IsJSON()
  options: Record<string, string>;

  @IsString()
  @Length(1, 1)
  correctOption: 'A' | 'B' | 'C' | 'D';

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsInt()
  @Min(0)
  questionIndex: number;

  @IsOptional()
  @IsUUID()
  sourceChunkId?: string;
}
