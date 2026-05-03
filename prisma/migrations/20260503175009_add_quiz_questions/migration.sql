-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "question_text" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_option" CHAR(1) NOT NULL,
    "explanation" TEXT,
    "question_index" INTEGER NOT NULL,
    "source_chunk_id" UUID,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_quiz_questions_quiz" ON "quiz_questions"("quiz_id");

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_source_chunk_id_fkey" FOREIGN KEY ("source_chunk_id") REFERENCES "chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
