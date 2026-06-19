-- DropIndex
DROP INDEX "DocChunk_path_chunkIndex_key";

-- AlterTable
ALTER TABLE "DocChunk" ADD COLUMN     "collection" TEXT NOT NULL DEFAULT 'markdown';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "DocChunk_collection_idx" ON "DocChunk"("collection");

-- CreateIndex
CREATE UNIQUE INDEX "DocChunk_collection_path_chunkIndex_key" ON "DocChunk"("collection", "path", "chunkIndex");

-- CreateIndex
CREATE INDEX "Job_userId_idx" ON "Job"("userId");


-- CreateIndex (HNSW for pgvector cosine search; operator class not expressible in schema.prisma)
CREATE INDEX "docchunk_embedding_hnsw" ON "DocChunk" USING hnsw (embedding vector_cosine_ops);
