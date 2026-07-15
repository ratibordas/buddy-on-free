// Ollama over the network can flicker, so every call gets a timeout and retries
// with backoff.
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { backoff, sleep } from '../helpers/index.js';

const log = logger.child('ollama');

interface EmbedResponse {
  embeddings: number[][];
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.OLLAMA_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Ollama ${path} -> ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const d = backoff(i, 500, 5_000);
        log.warn(`retry ${i + 1}/${attempts} in ${d}ms: ${(err as Error).message}`);
        await sleep(d);
      }
    }
  }
  throw lastErr;
}

/** Embeddings for a batch of strings. nomic-embed-text returns 768-dim. */
export async function embed(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const res = await withRetry(() =>
    postJson<EmbedResponse>('/api/embed', { model: config.OLLAMA_EMBED_MODEL, input: inputs }),
  );
  if (!res.embeddings || res.embeddings.length !== inputs.length) {
    throw new Error('Ollama returned an unexpected number of embeddings');
  }
  return res.embeddings;
}

export async function embedOne(input: string): Promise<number[]> {
  const [vec] = await embed([input]);
  if (!vec) throw new Error('empty embedding');
  return vec;
}

/** Check Ollama availability (for /ready and scripts). */
export async function pingOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
