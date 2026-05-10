import { Module } from '@nestjs/common';
import { ChunkController } from './chunk.controller';
import { ChunkService } from './chunk.service';

@Module({
  controllers: [ChunkController],
  providers: [ChunkService],
  exports: [ChunkService],
})
export class ChunkModule {}
