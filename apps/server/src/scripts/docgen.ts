// CLI: generate NL docs from a codebase (offline batch).
//   npm run docgen -- <source-dir> <out-dir>
// Then index the out-dir as a docs collection (add it to buddy.config.yaml
// sources, or: npm run index -- <out-dir> <collection>).
import { generateDocs } from '../docgen/service.js';
import { disconnectDb } from '../db/prisma.js';
import { pingOllama } from '../llm/ollama.js';
import { logger } from '../lib/logger.js';

const log = logger.child('docgen-cli');

async function main(): Promise<void> {
  const sourceDir = process.argv[2];
  const outDir = process.argv[3];
  const only = process.argv[4]; // optional: only generate groups whose name includes this
  if (!sourceDir || !outDir) {
    log.error('usage: npm run docgen -- <source-dir> <out-dir> [only-substring]');
    process.exit(1);
  }
  if (!(await pingOllama())) {
    log.error('Ollama unavailable — check OLLAMA_BASE_URL');
    process.exit(1);
  }
  const stats = await generateDocs(sourceDir, outDir, only ? { only } : {});
  log.info('done', stats);
}

main()
  .catch((err) => {
    log.error('docgen error', err);
    process.exitCode = 1;
  })
  .finally(() => void disconnectDb());
