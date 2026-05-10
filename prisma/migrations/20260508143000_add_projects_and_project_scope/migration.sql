-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- Add project relation to videos
ALTER TABLE "videos" ADD COLUMN "project_id" UUID;
CREATE INDEX "idx_videos_project_id" ON "videos"("project_id");

ALTER TABLE "videos"
  ADD CONSTRAINT "videos_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add project relation to chat sessions and allow legacy single-video sessions
ALTER TABLE "chat_sessions" DROP CONSTRAINT "chat_sessions_video_id_fkey";
ALTER TABLE "chat_sessions" ADD COLUMN "project_id" UUID;
ALTER TABLE "chat_sessions" ALTER COLUMN "video_id" DROP NOT NULL;
CREATE INDEX "idx_chat_sessions_project" ON "chat_sessions"("project_id");

ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_video_id_fkey"
  FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
