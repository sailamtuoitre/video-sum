import { Module } from '@nestjs/common';
import { ChunkModule } from '../chunks/chunk.module';
import { RagModule } from '../rag/rag.module';
import { ChatMessageController } from './chat-message.controller';
import { ChatSessionController } from './chat-session.controller';
import { ChatSessionService } from './chat-session.service';

@Module({
  imports: [ChunkModule, RagModule],
  controllers: [ChatSessionController, ChatMessageController],
  providers: [ChatSessionService],
})
export class ChatSessionModule {}
