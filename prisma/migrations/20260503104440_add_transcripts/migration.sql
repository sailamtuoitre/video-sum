-- CreateTable
CREATE TABLE "transcripts" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "raw_text" TEXT NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "word_count" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_transcripts_video_id" ON "transcripts"("video_id");

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
