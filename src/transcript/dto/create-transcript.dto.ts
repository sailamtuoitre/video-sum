import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateTranscriptDto {
  @IsUUID()
  videoId: string;

  @IsString()
  rawText: string;

  @IsIn(['youtube_caption', 'whisper'])
  source: 'youtube_caption' | 'whisper';

  @IsOptional()
  @IsInt()
  @Min(0)
  wordCount?: number;
}
