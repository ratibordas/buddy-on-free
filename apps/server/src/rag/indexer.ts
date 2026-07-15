// Walks a directory, chunks files (markdown by headings, code by lines), embeds
// via Ollama, stores in pgvector. sha256 dedup: unchanged chunks are skipped,
// stale ones deleted. Sources are separated by collection.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { sha256, toVectorLiteral } from '../helpers/index.js';
import { embed } from '../llm/ollama.js';
import { chunkMarkdown, type Chunk } from './chunker.js';
import { chunkCodeAst } from './astChunker.js';

const log = logger.child('indexer');

const DOC_EXT = new Set(['.md', '.mdx', '.markdown', '.txt']);
const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.rb', '.php', '.rs', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.kt', '.swift', '.vue', '.svelte', '.sql', '.json', '.yaml', '.yml',
]);
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  'coverage', '.turbo', '.cache', 'vendor', 'public', '.idea', '.vscode',
]);
const MAX_FILE_BYTES = 300_000; // skip huge/generated files

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      yield* walkFiles(full);
    } else {
      const ext = extname(entry.name).toLowerCase();
      if (DOC_EXT.has(ext) || CODE_EXT.has(ext)) yield full;
    }
  }
}

async function chunkFile(
  file: string,
  ext: string,
  raw: string,
): Promise<{ chunks: Chunk[]; source: string }> {
  // Docs: split by headings. Code: AST via tree-sitter helper (falls back to the
  // structure-aware chunker if the venv is absent). See astChunker.
  if (DOC_EXT.has(ext)) return { chunks: chunkMarkdown(raw), source: 'markdown' };
  return { chunks: await chunkCodeAst(file, raw, ext), source: 'code' };
}

// HNSW index for fast cosine search. IF NOT EXISTS — safe to run repeatedly.
export async function ensureVectorIndex(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS docchunk_embedding_hnsw ON "DocChunk" USING hnsw (embedding vector_cosine_ops);`,
  );
}

export interface IndexStats {
  files: number;
  chunks: number;
  embedded: number;
  skipped: number;
  deleted: number;
  failed: number;
}

export interface IndexOptions {
  collection?: string;
}

export async function indexDirectory(dir: string, opts: IndexOptions = {}): Promise<IndexStats> {
  const collection = opts.collection ?? 'markdown';
  const stats: IndexStats = { files: 0, chunks: 0, embedded: 0, skipped: 0, deleted: 0, failed: 0 };
  const failures: string[] = [];
  await ensureVectorIndex();

  for await (const file of walkFiles(dir)) {
    const rel = relative(dir, file);
    // Isolate per-file failures (oversized chunk, transient Ollama error, ...)
    // so one bad file is skipped+logged instead of aborting the whole run.
    try {
      const raw = await readFile(file, 'utf8');
      if (Buffer.byteLength(raw) > MAX_FILE_BYTES) {
        log.warn(`skip ${rel}: file too large`);
        continue;
      }
      const ext = extname(file).toLowerCase();
      const { chunks, source } = await chunkFile(file, ext, raw);
      stats.files++;
      stats.chunks += chunks.length;

      // Hashes of already-indexed chunks of this file in this collection.
      const existing = await prisma.docChunk.findMany({
        where: { collection, path: rel },
        select: { chunkIndex: true, contentHash: true },
      });
      const hashByIndex = new Map(existing.map((c) => [c.chunkIndex, c.contentHash]));

      const toEmbed = chunks.filter((c) => hashByIndex.get(c.index) !== sha256(c.content));
      let vectors: number[][] = [];
      if (toEmbed.length > 0) {
        vectors = await embed(toEmbed.map((c) => `search_document: ${c.content}`));
      }
      const vecByIndex = new Map<number, number[]>();
      toEmbed.forEach((c, i) => {
        const v = vectors[i];
        if (v) vecByIndex.set(c.index, v);
      });

      for (const c of chunks) {
        const hash = sha256(c.content);
        if (hashByIndex.get(c.index) === hash) {
          stats.skipped++;
          continue;
        }
        const vec = vecByIndex.get(c.index);
        if (!vec) continue;
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO "DocChunk" (id, collection, source, path, "chunkIndex", content, "contentHash", embedding, "createdAt")
          VALUES (${randomUUID()}, ${collection}, ${source}, ${rel}, ${c.index}, ${c.content}, ${hash}, ${toVectorLiteral(vec)}::vector, now())
          ON CONFLICT (collection, path, "chunkIndex") DO UPDATE
          SET content = EXCLUDED.content,
              "contentHash" = EXCLUDED."contentHash",
              embedding = EXCLUDED.embedding,
              source = EXCLUDED.source
        `);
        stats.embedded++;
      }

      const del = await prisma.docChunk.deleteMany({
        where: { collection, path: rel, chunkIndex: { gte: chunks.length } },
      });
      stats.deleted += del.count;
    } catch (err) {
      stats.failed++;
      failures.push(rel);
      log.error(`failed to index ${rel} — skipping`, (err as Error).message);
    }
  }

  if (failures.length > 0) {
    log.warn(
      `${failures.length} file(s) failed: ${failures.slice(0, 10).join(', ')}` +
        (failures.length > 10 ? ' ...' : ''),
    );
  }

  log.info(`indexing complete [collection=${collection}]`, stats);
  return stats;
}
