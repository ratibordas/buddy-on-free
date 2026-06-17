-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'processing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('api', 'telegram', 'slack');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('question', 'bug_report');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "externalId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "kind" "JobKind",
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "sources" JSONB,
    "error" TEXT,
    "etaSeconds" INTEGER,
    "position" INTEGER,
    "processingMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocChunk" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerCache" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "embedding" vector(768),
    "answer" TEXT NOT NULL,
    "sources" JSONB,
    "indexVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_channel_externalId_idx" ON "Job"("channel", "externalId");

-- CreateIndex
CREATE INDEX "DocChunk_source_idx" ON "DocChunk"("source");

-- CreateIndex
CREATE INDEX "DocChunk_contentHash_idx" ON "DocChunk"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "DocChunk_path_chunkIndex_key" ON "DocChunk"("path", "chunkIndex");
