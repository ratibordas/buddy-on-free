// Maps a configured source to the right indexing path: local docs/code walk the
// filesystem; remote doc connectors (Notion, Confluence) stream documents in.
// Adding a new doc format = a new connector here + a `type` in the config schema.
import { indexDirectory, indexDocuments, type IndexStats } from '../indexer.js';
import { fetchNotion } from './notion.js';
import { fetchConfluence } from './confluence.js';

export interface SourceSpec {
  collection: string;
  type: 'docs' | 'code' | 'notion' | 'confluence';
  path?: string;
  space?: string; // Confluence
  database?: string; // Notion
}

/** Index one configured source, dispatching by its type. */
export function indexSource(s: SourceSpec): Promise<IndexStats> {
  switch (s.type) {
    case 'notion':
      return indexDocuments(s.collection, 'notion', fetchNotion({ database: s.database }));
    case 'confluence':
      return indexDocuments(s.collection, 'confluence', fetchConfluence({ space: s.space }));
    case 'docs':
    case 'code':
    default:
      if (!s.path) throw new Error(`source "${s.collection}" (${s.type}) has no path`);
      return indexDirectory(s.path, { collection: s.collection });
  }
}
