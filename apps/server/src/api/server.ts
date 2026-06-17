import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMessageRoutes } from './routes/messages.js';

const log = logger.child('http');

// Extend Fastify with an authenticate decorator (JWT guard for protected routes).
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });

  // --- Security / middlewares ---
  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',').map((s) => s.trim()),
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // --- Auth (JWT, no roles) ---
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
  });
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // --- Routes ---
  await app.register(registerHealthRoutes);
  await app.register(registerAuthRoutes);
  await app.register(registerMessageRoutes);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    log.error('unhandled route error', err.message);
    const status = err.statusCode ?? 500;
    void reply.code(status).send({ error: status >= 500 ? 'internal_error' : err.message });
  });

  return app;
}
