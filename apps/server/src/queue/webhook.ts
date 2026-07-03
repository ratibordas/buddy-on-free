// Webhook delivery: POST the job result to a client-supplied callback URL when
// the answer is ready. Used instead of SSE/WebSocket for push delivery.
// Failures are retried with backoff and never propagate into the worker.
import { logger } from '../lib/logger.js';
import { backoff, sleep } from '../helpers/index.js';

const log = logger.child('webhook');

export interface WebhookPayload {
  jobId: string;
  status: string;
  answer: string | null;
  sources: unknown;
  error: string | null;
}

export async function deliverWebhook(url: string, payload: WebhookPayload): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        log.info(`delivered result for job ${payload.jobId} -> ${res.status}`);
        return;
      }
      log.warn(`job ${payload.jobId} -> ${res.status} (attempt ${attempt + 1})`);
    } catch (err) {
      log.warn(`job ${payload.jobId} attempt ${attempt + 1} failed: ${(err as Error).message}`);
    }
    if (attempt < 2) await sleep(backoff(attempt, 500, 5_000));
  }
  log.error(`webhook delivery failed for job ${payload.jobId} after retries`);
}
