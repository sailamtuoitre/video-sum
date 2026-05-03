-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "youtube_id" VARCHAR(20) NOT NULL,
    "url" TEXT NOT NULL,
    "title" VARCHAR(500),
    "duration_sec" INTEGER,
    "language" VARCHAR(10) NOT NULL DEFAULT 'vi',
    "status" "VideoStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "videos_youtube_id_key" ON "videos"("youtube_id");
