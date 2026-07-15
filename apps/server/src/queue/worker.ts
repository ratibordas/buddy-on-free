// Pulls jobs from RabbitMQ and runs them through the support graph.
// Concurrency = prefetch (WORKER_CONCURRENCY).
import { rabbitmq } from './connection.js';
import { prisma } from '../db/prisma.js';
import { runSupportGraph } from '../graph/support.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { QUEUE, type JobMessage } from '../types/index.js';
import { deliverWebhook, type WebhookPayload } from './webhook.js';

const log = logger.child('worker');

export async function startWorker(): Promise<void> {
  await rabbitmq.addConsumer({
    queue: QUEUE.jobs,
    prefetch: config.WORKER_CONCURRENCY,
    handler: async (msg, channel) => {
      const { jobId, callbackUrl } = JSON.parse(msg.content.toString()) as JobMessage;

      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job) {
        log.warn(`job ${jobId} not found — skipping`);
        channel.ack(msg);
        return;
      }

      const startedMs = Date.now();
      let result: WebhookPayload | null = null;
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
        result = { jobId, status: 'done', answer, sources, error: null };
        log.info(`job ${jobId} done in ${Date.now() - startedMs}ms`);
      } catch (err) {
        const message = (err as Error).message;
        log.error(`job ${jobId} failed`, message);
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            error: message,
            finishedAt: new Date(),
            processingMs: Date.now() - startedMs,
          },
        });
        result = { jobId, status: 'failed', answer: null, sources: null, error: message };
      } finally {
        // Push the result to the client's webhook if one was provided (no SSE/WS).
        if (callbackUrl && result) void deliverWebhook(callbackUrl, result);
        // Ack in any case: we don't want to retry endlessly, the failed
        // status is already recorded in the DB.
        channel.ack(msg);
      }
    },
  });
  log.info(`worker started (concurrency=${config.WORKER_CONCURRENCY})`);
}
