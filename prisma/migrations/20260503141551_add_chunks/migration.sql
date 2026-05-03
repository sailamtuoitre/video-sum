-- CreateTable
CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "token_count" INTEGER,
    "start_char" INTEGER,
    "end_char" INTEGER,
    "embedding_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_chunks_video_id" ON "chunks"("video_id");

-- CreateIndex
CREATE INDEX "idx_chunks_transcript" ON "chunks"("transcript_id");

-- CreateIndex
CREATE INDEX "idx_chunks_index" ON "chunks"("video_id", "chunk_index");

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
