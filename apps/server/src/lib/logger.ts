// Thin wrapper over console — basic logging with levels.
// Easy to swap for pino later without touching the call sites.
import { config } from '../config/index.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[config.LOG_LEVEL];

function emit(level: Level, scope: string, msg: string, meta?: unknown): void {
  if (order[level] < threshold) return;
  const ts = new Date().toISOString();
  const prefix = `${ts} ${level.toUpperCase()} [${scope}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta !== undefined) fn(prefix, msg, meta);
  else fn(prefix, msg);
}

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  child(scope: string): Logger;
}

export function createLogger(scope = 'app'): Logger {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
    child: (sub: string) => createLogger(`${scope}:${sub}`),
  };
}

export const logger = createLogger();
