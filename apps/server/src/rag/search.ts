// Retrieval over indexed chunks. Three modes:
//  - vector:  semantic search via pgvector (cosine), gated by minScore;
//  - lexical: Postgres full-text search (FTS, 'simple') over content_tsv;
//  - hybrid:  both arms fused with Reciprocal Rank Fusion (RRF).
// The lexical arm is fed by `lexicalTerms` (e.g. LLM query-expansion) so a
// natural-language question can still hit code that uses different identifiers.
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { toVectorLiteral } from '../helpers/index.js';
import { embedOne } from '../llm/ollama.js';

export type RetrievalMode = 'vector' | 'lexical' | 'hybrid';

export interface SearchHit {
  collection: string;
  path: string;
  content: string;
  source: string;
  score: number;
}

export interface SearchOptions {
  collections?: string[];
  mode?: RetrievalMode;
  minScore?: number; // cosine gate for the vector arm (0 = no gate)
  lexicalTerms?: string[]; // expanded keywords for the lexical arm
}

const RRF_K = 60; // standard RRF damping constant

function collFilter(collections?: string[]): Prisma.Sql {
  return collections && collections.length > 0
    ? Prisma.sql`AND collection = ANY(${collections})`
    : Prisma.empty;
}

/** Turn free-form terms/queries into a safe `to_tsquery('simple', ...)` OR-expression. */
function toTsQuery(terms: string[]): string | null {
  const words = new Set<string>();
  for (const t of terms) {
    for (const w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 2) words.add(w);
    }
  }
  return words.size > 0 ? [...words].join(' | ') : null;
}

async function searchVector(
  query: string,
  k: number,
  collections: string[] | undefined,
  minScore: number,
): Promise<SearchHit[]> {
  const lit = toVectorLiteral(await embedOne(`search_query: ${query}`));
  const rows = await prisma.$queryRaw<SearchHit[]>`
    SELECT collection, path, content, source, 1 - (embedding <=> ${lit}::vector) AS score
    FROM "DocChunk"
    WHERE embedding IS NOT NULL ${collFilter(collections)}
    ORDER BY embedding <=> ${lit}::vector
    LIMIT ${k}
  `;
  return rows.filter((h) => h.score >= minScore);
}

async function searchLexical(
  tsq: string,
  k: number,
  collections: string[] | undefined,
): Promise<SearchHit[]> {
  return prisma.$queryRaw<SearchHit[]>`
    SELECT collection, path, content, source, ts_rank(content_tsv, to_tsquery('simple', ${tsq})) AS score
    FROM "DocChunk"
    WHERE content_tsv @@ to_tsquery('simple', ${tsq}) ${collFilter(collections)}
    ORDER BY score DESC
    LIMIT ${k}
  `;
}

async function searchHybrid(
  query: string,
  tsq: string,
  k: number,
  collections: string[] | undefined,
  minScore: number,
): Promise<SearchHit[]> {
  const lit = toVectorLiteral(await embedOne(`search_query: ${query}`));
  const cand = Math.max(k * 5, 20);
  const coll = collFilter(collections);
  return prisma.$queryRaw<SearchHit[]>`
    WITH vec AS (
      SELECT id, row_number() OVER (ORDER BY embedding <=> ${lit}::vector) AS rnk
      FROM "DocChunk"
      WHERE embedding IS NOT NULL ${coll}
        AND 1 - (embedding <=> ${lit}::vector) >= ${minScore}
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${cand}
    ),
    lex AS (
      SELECT id, row_number() OVER (ORDER BY ts_rank(content_tsv, to_tsquery('simple', ${tsq})) DESC) AS rnk
      FROM "DocChunk"
      WHERE content_tsv @@ to_tsquery('simple', ${tsq}) ${coll}
      ORDER BY ts_rank(content_tsv, to_tsquery('simple', ${tsq})) DESC
      LIMIT ${cand}
    ),
    fused AS (
      SELECT COALESCE(v.id, l.id) AS id,
             COALESCE(1.0 / (${RRF_K} + v.rnk), 0) + COALESCE(1.0 / (${RRF_K} + l.rnk), 0) AS score
      FROM vec v FULL OUTER JOIN lex l ON v.id = l.id
    )
    SELECT d.collection, d.path, d.content, d.source, f.score::float AS score
    FROM fused f JOIN "DocChunk" d ON d.id = f.id
    ORDER BY f.score DESC
    LIMIT ${k}
  `;
}

export async function search(query: string, k = 5, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const mode = opts.mode ?? 'vector';
  const minScore = opts.minScore ?? 0;
  const tsq = toTsQuery(opts.lexicalTerms && opts.lexicalTerms.length ? opts.lexicalTerms : [query]);

  if (mode === 'lexical') {
    return tsq ? searchLexical(tsq, k, opts.collections) : [];
  }
  if (mode === 'hybrid' && tsq) {
    return searchHybrid(query, tsq, k, opts.collections, minScore);
  }
  // vector, or hybrid with no usable lexical query
  return searchVector(query, k, opts.collections, minScore);
}
