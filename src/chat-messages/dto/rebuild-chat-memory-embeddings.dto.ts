import { IsOptional, IsUUID } from 'class-validator';

export class RebuildChatMemoryEmbeddingsDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  videoId?: string;
}
