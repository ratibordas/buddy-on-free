// Accepting a message into the queue and returning its status.
import { prisma } from '../db/prisma.js';
import { rabbitmq } from './connection.js';
import { estimate } from './stats.js';
import { QUEUE, type IncomingMessage, type EnqueueResult } from '../types/index.js';

/** Enqueue a message and return jobId + position + ETA right away. */
export async function enqueueMessage(input: IncomingMessage): Promise<EnqueueResult> {
  const job = await prisma.job.create({
    data: {
      channel: input.channel,
      externalId: input.externalId ?? null,
      question: input.text,
      status: 'queued',
    },
  });

  const { position, etaSeconds } = await estimate(job.createdAt);
  await prisma.job.update({ where: { id: job.id }, data: { position, etaSeconds } });

  rabbitmq.publish(QUEUE.jobs, { jobId: job.id });

  return { jobId: job.id, position, etaSeconds };
}

export interface JobStatusView {
  jobId: string;
  status: string;
  question: string;
  answer: string | null;
  sources: unknown;
  error: string | null;
  position?: number;
  etaSeconds?: number;
}

/** Current status of a job. For unfinished ones we recompute position/ETA on the fly. */
export async function getJobStatus(jobId: string): Promise<JobStatusView | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;

  const view: JobStatusView = {
    jobId: job.id,
    status: job.status,
    question: job.question,
    answer: job.answer,
    sources: job.sources,
    error: job.error,
  };

  if (job.status === 'queued' || job.status === 'processing') {
    const { position, etaSeconds } = await estimate(job.createdAt);
    view.position = position;
    view.etaSeconds = etaSeconds;
  }

  return view;
}
