// CLI: index a directory of markdown.
//   npm run index -- ../../sample-docs
import { indexDirectory } from '../rag/indexer.js';
import { disconnectDb } from '../db/prisma.js';
import { pingOllama } from '../llm/ollama.js';
import { logger } from '../lib/logger.js';

const log = logger.child('index-docs');

async function main(): Promise<void> {
  const dir = process.argv[2];
  const collection = process.argv[3]; // e.g. frontend / backend / generated-docs
  if (!dir) {
    log.error('usage: npm run index -- <path-to-directory> [collection]');
    process.exit(1);
  }
  if (!(await pingOllama())) {
    log.error(`Ollama unavailable — check OLLAMA_BASE_URL and that the embeddings model is loaded`);
    process.exit(1);
  }
  const stats = await indexDirectory(dir, collection ? { collection } : {});
  log.info('done', stats);
}

main()
  .catch((err) => {
    log.error('indexing error', err);
    process.exitCode = 1;
  })
  .finally(() => void disconnectDb());
