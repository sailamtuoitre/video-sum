import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSummaryDto {
  @IsUUID()
  videoId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  keyPoints: string[];

  @IsString()
  simplifiedText: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mainTopics?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelUsed?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  promptTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  completionTokens?: number;
}
