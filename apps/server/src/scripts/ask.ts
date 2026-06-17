// CLI: ask the bot a question through the graph (retrieve -> generate).
//   npm run ask -- "how do I reset my password"
import { runSupportGraph } from '../graph/support.js';
import { disconnectDb } from '../db/prisma.js';
import { pingOllama } from '../llm/ollama.js';
import { logger } from '../lib/logger.js';

const log = logger.child('ask');

async function main(): Promise<void> {
  // --collection=a,b restricts the search; the rest is the question text.
  const args = process.argv.slice(2);
  const collArg = args.find((a) => a.startsWith('--collection='));
  const collections = collArg ? collArg.split('=')[1]!.split(',').filter(Boolean) : [];
  const question = args.filter((a) => !a.startsWith('--collection=')).join(' ');

  if (!question) {
    log.error('usage: npm run ask -- [--collection=a,b] "your question"');
    process.exit(1);
  }
  if (!(await pingOllama())) {
    log.error('Ollama unavailable — check OLLAMA_BASE_URL');
    process.exit(1);
  }

  const { answer, sources } = await runSupportGraph(question, collections);
  console.log(`\n❓ ${question}`);
  if (collections.length) console.log(`📂 collections: ${collections.join(', ')}`);
  console.log(`\n💬 ${answer}\n`);
  console.log(`📎 sources: ${sources.length ? sources.join(', ') : '—'}\n`);
}

main()
  .catch((err) => {
    log.error('error', err);
    process.exitCode = 1;
  })
  .finally(() => void disconnectDb());
