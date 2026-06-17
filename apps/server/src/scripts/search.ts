// CLI: test semantic search.
//   npm run search -- "how to reset password"
import { search } from '../rag/search.js';
import { disconnectDb } from '../db/prisma.js';
import { pingOllama } from '../llm/ollama.js';
import { logger } from '../lib/logger.js';

const log = logger.child('search');

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    log.error('usage: npm run search -- "your query"');
    process.exit(1);
  }
  if (!(await pingOllama())) {
    log.error('Ollama unavailable — check OLLAMA_BASE_URL');
    process.exit(1);
  }
  const hits = await search(query, 5);
  console.log(`\nQuery: ${query}\n`);
  hits.forEach((h, i) => {
    const preview = h.content.replace(/\s+/g, ' ').slice(0, 160);
    console.log(`${i + 1}. [${h.score.toFixed(3)}] ${h.path}`);
    console.log(`   ${preview}${h.content.length > 160 ? '…' : ''}\n`);
  });
}

main()
  .catch((err) => {
    log.error('search error', err);
    process.exitCode = 1;
  })
  .finally(() => void disconnectDb());
