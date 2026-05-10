import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { IngestService } from './ingest.service';

@Module({
  imports: [],
  controllers: [RagController],
  providers: [RagService, IngestService],
  exports: [RagService],
})
export class RagModule {}
