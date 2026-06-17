import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { onShutdown, registerShutdownSignals } from './lib/shutdown.js';
import { prisma, disconnectDb } from './db/prisma.js';
import { rabbitmq } from './queue/connection.js';
import { startWorker } from './queue/worker.js';
import { QUEUE } from './types/index.js';
import { buildServer } from './api/server.js';

const log = logger.child('main');

async function main(): Promise<void> {
  registerShutdownSignals();

  // 1. DB — the connection is verified by the first query; Prisma connects lazily.
  await prisma.$connect();
  onShutdown('prisma', disconnectDb);
  log.info('Postgres connected');

  // 2. RabbitMQ — declare the topology (job queue). Reconnect handled internally.
  await rabbitmq.connect();
  await rabbitmq.registerTopology(async (channel) => {
    await channel.assertQueue(QUEUE.jobs, { durable: true });
  });
  onShutdown('rabbitmq', () => rabbitmq.close());

  // 3. Worker — in the same process (sufficient for the free version; later it's easy
  //    to move it to a separate process/deployment).
  await startWorker();

  // 4. HTTP server.
  const app = await buildServer();
  await app.listen({ host: config.HOST, port: config.PORT });
  onShutdown('http', () => app.close());
  log.info(`server listening on http://${config.HOST}:${config.PORT}`);
}

main().catch((err) => {
  log.error('fatal error during startup', err);
  process.exit(1);
});
