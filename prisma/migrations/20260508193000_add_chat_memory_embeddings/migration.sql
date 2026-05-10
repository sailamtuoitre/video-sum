CREATE TABLE "chat_memory_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "project_id" UUID,
    "video_id" UUID,
    "turn_index" INTEGER NOT NULL,
    "user_message_id" UUID NOT NULL,
    "assistant_message_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(384) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "chat_memory_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_memory_embeddings_assistant_message_id_key" ON "chat_memory_embeddings"("assistant_message_id");
CREATE INDEX "idx_chat_memory_embeddings_session_id" ON "chat_memory_embeddings"("session_id");
CREATE INDEX "idx_chat_memory_embeddings_project_id" ON "chat_memory_embeddings"("project_id");
CREATE INDEX "idx_chat_memory_embeddings_video_id" ON "chat_memory_embeddings"("video_id");
CREATE INDEX "idx_chat_memory_embeddings_turn_index" ON "chat_memory_embeddings"("session_id", "turn_index");
CREATE INDEX "idx_chat_memory_embeddings_embedding" ON "chat_memory_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 10);

ALTER TABLE "chat_memory_embeddings"
  ADD CONSTRAINT "chat_memory_embeddings_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_memory_embeddings"
  ADD CONSTRAINT "chat_memory_embeddings_user_message_id_fkey"
  FOREIGN KEY ("user_message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_memory_embeddings"
  ADD CONSTRAINT "chat_memory_embeddings_assistant_message_id_fkey"
  FOREIGN KEY ("assistant_message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_memory_embeddings"
  ADD CONSTRAINT "chat_memory_embeddings_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_memory_embeddings"
  ADD CONSTRAINT "chat_memory_embeddings_video_id_fkey"
  FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
