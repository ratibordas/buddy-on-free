// Graceful-shutdown registry: components register their close functions,
// which run in reverse order (LIFO) on SIGTERM/SIGINT.
import { logger } from './logger.js';

const log = logger.child('shutdown');

interface Hook {
  name: string;
  fn: () => Promise<void> | void;
}

const hooks: Hook[] = [];
let shuttingDown = false;

export function onShutdown(name: string, fn: Hook['fn']): void {
  hooks.push({ name, fn });
}

async function runShutdown(signal: string, timeoutMs = 15000): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`received ${signal}, starting graceful shutdown`);

  const timer = setTimeout(() => {
    log.error(`shutdown exceeded ${timeoutMs}ms — forcing exit`);
    process.exit(1);
  }, timeoutMs);
  timer.unref();

  // LIFO: last started — first shut down.
  for (const hook of [...hooks].reverse()) {
    try {
      log.info(`closing: ${hook.name}`);
      await hook.fn();
    } catch (err) {
      log.error(`error while closing ${hook.name}`, err);
    }
  }

  clearTimeout(timer);
  log.info('shutdown complete');
  process.exit(0);
}

export function registerShutdownSignals(): void {
  process.on('SIGTERM', () => void runShutdown('SIGTERM'));
  process.on('SIGINT', () => void runShutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', reason);
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', err);
    void runShutdown('uncaughtException');
  });
}
