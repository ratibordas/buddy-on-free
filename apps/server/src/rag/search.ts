// Semantic search over indexed chunks via pgvector.
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { toVectorLiteral } from '../helpers/index.js';
import { embedOne } from '../llm/ollama.js';

export interface SearchHit {
  collection: string;
  path: string;
  content: string;
  source: string;
  score: number; // 1 - cosine distance, the higher the more relevant
}

export interface SearchOptions {
  collections?: string[]; // restrict the search to a set of collections
}

export async function search(query: string, k = 5, opts: SearchOptions = {}): Promise<SearchHit[]> {
  // The search_query: prefix is nomic-embed-text's recommendation for queries.
  const vec = await embedOne(`search_query: ${query}`);
  const lit = toVectorLiteral(vec);

  const collFilter =
    opts.collections && opts.collections.length > 0
      ? Prisma.sql`AND collection = ANY(${opts.collections})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<SearchHit[]>`
    SELECT collection, path, content, source, 1 - (embedding <=> ${lit}::vector) AS score
    FROM "DocChunk"
    WHERE embedding IS NOT NULL ${collFilter}
    ORDER BY embedding <=> ${lit}::vector
    LIMIT ${k}
  `;
  return rows;
}
