import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const log = logger.child('db');

export const prisma = new PrismaClient({
  log: config.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

/** Check DB connection (used in /health and on startup). */
export async function pingDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    log.error('ping failed', err);
    return false;
  }
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
  log.info('disconnected');
}
