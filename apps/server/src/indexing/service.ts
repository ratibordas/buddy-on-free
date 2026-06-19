// Indexing service: drives the RAG indexer over the sources from buddy.config.yaml.
// Indexing is incremental (sha256 dedup), so re-running is cheap.
import { prisma } from '../db/prisma.js';
import { appConfig } from '../config/appConfig.js';
import { indexDirectory } from '../rag/indexer.js';
import { logger } from '../lib/logger.js';

const log = logger.child('indexing');

/** Index every configured source. Per-source failures are logged, not thrown. */
export async function indexAllSources(): Promise<void> {
  if (appConfig.sources.length === 0) {
    log.warn('no sources configured');
    return;
  }
  for (const s of appConfig.sources) {
    try {
      const stats = await indexDirectory(s.path, { collection: s.collection });
      log.info(`indexed "${s.collection}"`, stats);
    } catch (err) {
      log.error(`failed to index "${s.collection}" (${s.path})`, (err as Error).message);
    }
  }
}

/**
 * Make sure no configured collection is empty before serving — otherwise the bot
 * would answer "no info" against an empty index. Empty collections are indexed
 * synchronously; failures degrade gracefully (server still starts).
 */
export async function ensureSeedIndex(): Promise<void> {
  for (const s of appConfig.sources) {
    const count = await prisma.docChunk.count({ where: { collection: s.collection } });
    if (count > 0) {
      log.info(`collection "${s.collection}": ${count} chunks present`);
      continue;
    }
    log.info(`collection "${s.collection}" is empty — indexing before serving...`);
    try {
      const stats = await indexDirectory(s.path, { collection: s.collection });
      log.info(`seed-indexed "${s.collection}"`, stats);
    } catch (err) {
      log.error(
        `seed index failed for "${s.collection}" — serving degraded until reindex succeeds`,
        (err as Error).message,
      );
    }
  }
}
