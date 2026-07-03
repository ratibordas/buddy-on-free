// Receiving messages and returning status. Protected by JWT.
import type { FastifyInstance } from 'fastify';
import { MessageChannel } from '@prisma/client';
import { z } from 'zod';
import { enqueueMessage, getJobStatus } from '../../queue/jobs.js';

const messageSchema = z.object({
  text: z.string().min(1),
  channel: z.nativeEnum(MessageChannel).default(MessageChannel.api),
  externalId: z.string().optional(),
  callbackUrl: z.string().url().optional(), // POSTed with the result when ready
});

export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  // Receive a message → enqueue it. Immediately return jobId + position + ETA.
  app.post('/messages', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const userId = (req.user as { sub?: string } | undefined)?.sub;
    const result = await enqueueMessage({
      channel: parsed.data.channel,
      text: parsed.data.text,
      userId,
      externalId: parsed.data.externalId,
      callbackUrl: parsed.data.callbackUrl,
    });
    return reply.code(202).send(result);
  });

  // Job status (for client polling).
  app.get('/status/:jobId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const status = await getJobStatus(jobId);
    if (!status) return reply.code(404).send({ error: 'not_found' });
    return reply.send(status);
  });
}
