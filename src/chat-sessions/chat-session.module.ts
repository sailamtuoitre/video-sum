import { Module } from '@nestjs/common';
import { ChatSessionController } from './chat-session.controller';
import { ChatSessionService } from './chat-session.service';

@Module({
  controllers: [ChatSessionController],
  providers: [ChatSessionService],
})
export class ChatSessionModule {}
