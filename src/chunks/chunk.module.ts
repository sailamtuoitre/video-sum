import { Module } from '@nestjs/common';
import { ChunkController } from './chunk.controller';
import { ChunkService } from './chunk.service';

@Module({
  controllers: [ChunkController],
  providers: [ChunkService],
})
export class ChunkModule {}
