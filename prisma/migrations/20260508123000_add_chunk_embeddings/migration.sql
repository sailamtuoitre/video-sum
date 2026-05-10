-- Required for gen_random_uuid() and pgvector support
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- Vector store for transcript chunks
CREATE TABLE "chunk_embeddings" (
    "id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "start_char" INTEGER,
    "end_char" INTEGER,
    "embedding" vector(384) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunk_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chunk_embeddings_chunk_id_key" ON "chunk_embeddings"("chunk_id");
CREATE INDEX "idx_chunk_embeddings_video_id" ON "chunk_embeddings"("video_id");
CREATE INDEX "idx_chunk_embeddings_transcript_id" ON "chunk_embeddings"("transcript_id");
CREATE INDEX "idx_chunk_embeddings_chunk_index" ON "chunk_embeddings"("video_id", "chunk_index");
CREATE INDEX "idx_chunk_embeddings_embedding" ON "chunk_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 10);

ALTER TABLE "chunk_embeddings"
  ADD CONSTRAINT "chunk_embeddings_chunk_id_fkey"
  FOREIGN KEY ("chunk_id") REFERENCES "chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
