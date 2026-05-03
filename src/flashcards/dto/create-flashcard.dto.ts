import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateFlashcardDto {
  @IsUUID()
  setId: string;

  @IsString()
  front: string;

  @IsString()
  back: string;

  @IsInt()
  @Min(0)
  cardIndex: number;

  @IsOptional()
  @IsUUID()
  sourceChunkId?: string;
}
