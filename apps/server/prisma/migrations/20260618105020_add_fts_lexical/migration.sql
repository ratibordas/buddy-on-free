-- Lexical search arm for hybrid retrieval: generated tsvector + GIN index.
-- 'simple' config = lowercase + tokenize, no stemming (robust for code + mixed languages).
ALTER TABLE "DocChunk"
  ADD COLUMN "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED;

CREATE INDEX "docchunk_content_tsv_gin" ON "DocChunk" USING gin ("content_tsv");
