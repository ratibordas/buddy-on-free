// Shared application types and DTOs. Domain model enums come from the Prisma client,
// here — transport/application-level types.
import type { MessageChannel } from '@prisma/client';

/** Normalized incoming message from any source. */
export interface IncomingMessage {
  channel: MessageChannel;
  text: string;
  /** owner (JWT subject); absent for messenger sources for now. */
  userId?: string;
  /** chat/message id in the external messenger (for replying back). */
  externalId?: string;
}

/** Response to the client right after receiving a message. */
export interface EnqueueResult {
  jobId: string;
  position: number;
  etaSeconds: number;
}

/** Payload we put into RabbitMQ for the worker. */
export interface JobMessage {
  jobId: string;
}

/** Payload for a re-index request. */
export interface ReindexMessage {
  trigger: 'startup' | 'cron' | 'manual';
}

/** RabbitMQ queue names. */
export const QUEUE = {
  jobs: 'buddy.jobs',
  reindex: 'buddy.reindex',
} as const;
