import { createHash } from 'node:crypto';
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Exponential backoff with a cap. */
export function backoff(attempt: number, baseMs = 1000, maxMs = 30000): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

/** Serialize a numeric vector into a pgvector literal: '[0.1,0.2,...]'. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/** Human-readable time estimate. */
export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}
