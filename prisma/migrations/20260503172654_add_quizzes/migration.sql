-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "title" VARCHAR(200),
    "total_questions" INTEGER NOT NULL DEFAULT 0,
    "model_used" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_quizzes_video_id" ON "quizzes"("video_id");

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
