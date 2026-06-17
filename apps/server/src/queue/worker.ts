// Worker: pulls jobs from RabbitMQ and runs them through the support graph.
// Concurrency is set by prefetch = WORKER_CONCURRENCY (that many jobs in flight
// at once). Re-subscribes automatically after a broker reconnect.
import { rabbitmq } from './connection.js';
import { prisma } from '../db/prisma.js';
import { runSupportGraph } from '../graph/support.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { QUEUE, type JobMessage } from '../types/index.js';

const log = logger.child('worker');

export async function startWorker(): Promise<void> {
  await rabbitmq.addConsumer({
    queue: QUEUE.jobs,
    prefetch: config.WORKER_CONCURRENCY,
    handler: async (msg, channel) => {
      const { jobId } = JSON.parse(msg.content.toString()) as JobMessage;

      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job) {
        log.warn(`job ${jobId} not found — skipping`);
        channel.ack(msg);
        return;
      }

      const startedMs = Date.now();
      try {
        await prisma.job.update({
          where: { id: jobId },
          data: { status: 'processing', startedAt: new Date() },
        });

        const { answer, sources } = await runSupportGraph(job.question);

        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'done',
            answer,
            sources,
            finishedAt: new Date(),
            processingMs: Date.now() - startedMs,
          },
        });
        log.info(`job ${jobId} done in ${Date.now() - startedMs}ms`);
      } catch (err) {
        log.error(`job ${jobId} failed`, (err as Error).message);
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            error: (err as Error).message,
            finishedAt: new Date(),
            processingMs: Date.now() - startedMs,
          },
        });
      } finally {
        // Ack in any case: we don't want to retry endlessly, the failed
        // status is already recorded in the DB.
        channel.ack(msg);
      }
    },
  });
  log.info(`worker started (concurrency=${config.WORKER_CONCURRENCY})`);
}
