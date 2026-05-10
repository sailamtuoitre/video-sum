import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class CreateChatMessageDto {
  @IsUUID()
  sessionId: string;

  @IsString()
  @Length(1, 20)
  role: 'user' | 'assistant';

  @IsString()
  content: string;

  @IsOptional()
  @IsArray()
  retrievedChunks?: unknown[];

  @IsOptional()
  @IsInt()
  @Min(0)
  promptTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  completionTokens?: number;
}
