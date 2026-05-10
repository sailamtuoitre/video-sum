import { IsString, IsUUID, Length } from 'class-validator';

export class AskChatMessageDto {
  @IsUUID()
  sessionId: string;

  @IsString()
  @Length(1, 4000)
  content: string;
}
