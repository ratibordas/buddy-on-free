// Throughput estimation for computing ETA.
// We take the moving average of processing time straight from the DB (last N
// completed jobs) — survives a restart, requires no separate state.
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';

const SAMPLE = 50;

/** Average job processing time in ms (over the most recently completed). */
export async function getAvgProcessingMs(): Promise<number> {
  const rows = await prisma.$queryRaw<{ avg: number | null }[]>`
    SELECT avg("processingMs")::float AS avg FROM (
      SELECT "processingMs" FROM "Job"
      WHERE status = 'done' AND "processingMs" IS NOT NULL
      ORDER BY "finishedAt" DESC
      LIMIT ${SAMPLE}
    ) t`;
  const avg = rows[0]?.avg ?? null;
  return avg && avg > 0 ? avg : config.DEFAULT_ETA_SECONDS * 1000;
}

/**
 * Queue position and ETA for a job created at createdAt.
 * position — how many jobs (including this one) are not yet finished and were enqueued no later.
 * eta — rough estimate: ceil(position / concurrency) * average_time.
 */
export async function estimate(createdAt: Date): Promise<{ position: number; etaSeconds: number }> {
  const position = await prisma.job.count({
    where: { status: { in: ['queued', 'processing'] }, createdAt: { lte: createdAt } },
  });
  const avgMs = await getAvgProcessingMs();
  const concurrency = config.WORKER_CONCURRENCY;
  const etaSeconds = Math.ceil(position / concurrency) * Math.ceil(avgMs / 1000);
  return { position, etaSeconds };
}
