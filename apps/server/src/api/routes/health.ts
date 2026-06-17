import type { FastifyInstance } from 'fastify';
import { pingDb } from '../../db/prisma.js';
import { rabbitmq } from '../../queue/connection.js';
import { pingOllama } from '../../llm/ollama.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness — the process is alive.
  app.get('/health', async () => ({ status: 'ok' }));

  // Readiness — dependencies are available.
  app.get('/ready', async (_req, reply) => {
    const [db, ollama] = await Promise.all([pingDb(), pingOllama()]);
    const mq = rabbitmq.isReady();
    const ready = db && mq && ollama;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'degraded',
      checks: { db, rabbitmq: mq, ollama },
    });
  });
}
