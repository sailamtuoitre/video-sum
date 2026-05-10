-- Allow flashcard sets to belong to a project or a single video
ALTER TABLE "flashcard_sets" ADD COLUMN "project_id" UUID;
ALTER TABLE "flashcard_sets" ALTER COLUMN "video_id" DROP NOT NULL;

CREATE INDEX "idx_flashcard_sets_project" ON "flashcard_sets"("project_id");

ALTER TABLE "flashcard_sets"
  ADD CONSTRAINT "flashcard_sets_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
