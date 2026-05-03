-- CreateTable
CREATE TABLE "summaries" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "key_points" JSONB NOT NULL,
    "simplified_text" TEXT NOT NULL,
    "main_topics" JSONB,
    "model_used" VARCHAR(100),
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idx_summaries_video_id" ON "summaries"("video_id");

-- AddForeignKey
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
