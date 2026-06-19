// Re-index scheduling. RabbitMQ is not a scheduler, so node-cron triggers it by
// publishing a reindex message; a dedicated consumer runs the actual indexing
// (decoupled, survives restarts, runs on a single worker via prefetch=1).
import cron from 'node-cron';
import { rabbitmq } from '../queue/connection.js';
import { appConfig } from '../config/appConfig.js';
import { indexAllSources } from './service.js';
import { logger } from '../lib/logger.js';
import { QUEUE, type ReindexMessage } from '../types/index.js';

const log = logger.child('reindex');

export async function startReindexConsumer(): Promise<void> {
  await rabbitmq.addConsumer({
    queue: QUEUE.reindex,
    prefetch: 1,
    handler: async (msg, channel) => {
      const { trigger } = JSON.parse(msg.content.toString()) as ReindexMessage;
      log.info(`reindex triggered (${trigger})`);
      try {
        await indexAllSources();
      } finally {
        channel.ack(msg);
      }
    },
  });
}

/** Enqueue a re-index request (processed by the consumer). */
export function triggerReindex(trigger: ReindexMessage['trigger'] = 'manual'): void {
  rabbitmq.publish(QUEUE.reindex, { trigger } satisfies ReindexMessage);
}

/** Schedule a periodic re-index from the cron expression in the config. */
export function scheduleReindex(): void {
  const expr = appConfig.reindex.cron;
  if (!expr) {
    log.info('no reindex cron configured');
    return;
  }
  if (!cron.validate(expr)) {
    log.error(`invalid cron expression "${expr}" — schedule skipped`);
    return;
  }
  cron.schedule(expr, () => {
    log.info('cron tick — enqueuing reindex');
    triggerReindex('cron');
  });
  log.info(`reindex scheduled: "${expr}"`);
}
