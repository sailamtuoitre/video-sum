import { Module } from '@nestjs/common';
import { ChunkModule } from '../chunks/chunk.module';
import { SummaryModule } from '../summaries/summary.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { ChatMessageController } from './chat-message.controller';
import { ChatMessageService } from './chat-message.service';

@Module({
  imports: [ChunkModule, SummaryModule, VectorStoreModule],
  controllers: [ChatMessageController],
  providers: [ChatMessageService],
})
export class ChatMessageModule {}
