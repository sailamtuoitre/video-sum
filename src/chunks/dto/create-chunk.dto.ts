import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateChunkDto {
  @IsUUID()
  videoId: string;

  @IsUUID()
  transcriptId: string;

  @IsString()
  content: string;

  @IsInt()
  @Min(0)
  chunkIndex: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  tokenCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  startChar?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  endChar?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  embeddingId?: string;
}
