-- CreateEnum
CREATE TYPE "FlashcardStudyStatus" AS ENUM ('pending', 'known', 'unknown');

-- CreateTable
CREATE TABLE "flashcard_study_progress" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "flashcard_id" UUID NOT NULL,
    "status" "FlashcardStudyStatus" NOT NULL DEFAULT 'pending',
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "last_reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "flashcard_study_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uniq_flashcard_study_progress_card" ON "flashcard_study_progress"("set_id", "flashcard_id");
CREATE INDEX "idx_flashcard_study_progress_set" ON "flashcard_study_progress"("set_id");
CREATE INDEX "idx_flashcard_study_progress_card" ON "flashcard_study_progress"("flashcard_id");

-- AddForeignKey
ALTER TABLE "flashcard_study_progress"
  ADD CONSTRAINT "flashcard_study_progress_set_id_fkey"
  FOREIGN KEY ("set_id") REFERENCES "flashcard_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flashcard_study_progress"
  ADD CONSTRAINT "flashcard_study_progress_flashcard_id_fkey"
  FOREIGN KEY ("flashcard_id") REFERENCES "flashcards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
