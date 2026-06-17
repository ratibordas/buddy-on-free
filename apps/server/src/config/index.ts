import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGIN: z.string().default('*'),

  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().default('24h'),

  DATABASE_URL: z.string().url(),

  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(2),

  OLLAMA_BASE_URL: z.string().url(),
  OLLAMA_CHAT_MODEL: z.string().default('qwen2.5:7b-instruct'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  DEFAULT_ETA_SECONDS: z.coerce.number().int().positive().default(20),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Logger is not initialized yet — write directly and exit.
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

export const isProd = config.NODE_ENV === 'production';
