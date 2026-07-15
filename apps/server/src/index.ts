import { config } from './config/index.js';
import { appConfig } from './config/appConfig.js';
import { logger } from './lib/logger.js';
import { onShutdown, registerShutdownSignals } from './lib/shutdown.js';
import { prisma, disconnectDb } from './db/prisma.js';
import { rabbitmq } from './queue/connection.js';
import { startWorker } from './queue/worker.js';
import { ensureSeedIndex } from './indexing/service.js';
import { startReindexConsumer, scheduleReindex, triggerReindex } from './indexing/scheduler.js';
import { QUEUE } from './types/index.js';
import { buildServer } from './api/server.js';

const log = logger.child('main');

async function main(): Promise<void> {
  registerShutdownSignals();

  // Prisma connects lazily; the first query verifies the connection.
  await prisma.$connect();
  onShutdown('prisma', disconnectDb);
  log.info('Postgres connected');

  // RabbitMQ topology (job + reindex queues); reconnects are handled inside.
  await rabbitmq.connect();
  await rabbitmq.registerTopology(async (channel) => {
    await channel.assertQueue(QUEUE.jobs, { durable: true });
    await channel.assertQueue(QUEUE.reindex, { durable: true });
  });
  onShutdown('rabbitmq', () => rabbitmq.close());

  // Workers run in-process; easy to split into a separate deployment later.
  await startWorker();
  await startReindexConsumer();

  // Never serve against an empty index.
  await ensureSeedIndex();
  const app = await buildServer();
  await app.listen({ host: config.HOST, port: config.PORT });
  onShutdown('http', () => app.close());
  log.info(`server listening on http://${config.HOST}:${config.PORT}`);

  // Refresh on boot + scheduled re-index.
  if (appConfig.reindex.onStartup) triggerReindex('startup');
  scheduleReindex();
}

main().catch((err) => {
  log.error('fatal error during startup', err);
  process.exit(1);
});
