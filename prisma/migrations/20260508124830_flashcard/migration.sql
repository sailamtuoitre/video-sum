/*
  Warnings:

  - You are about to drop the `chunk_embeddings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "chunk_embeddings" DROP CONSTRAINT "chunk_embeddings_chunk_id_fkey";

-- DropTable
DROP TABLE "chunk_embeddings";
