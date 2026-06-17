// Resilient connection to RabbitMQ.
//
// Guarantees on broker disconnect/restart:
//  - auto-reconnect with exponential backoff;
//  - the channel is recreated;
//  - the entire topology (exchange/queue) is re-declared;
//  - ALL consumers are re-subscribed automatically.
//
// From the outside we only work through registerTopology / addConsumer / publish —
// they survive reconnects transparently.
import amqp from 'amqplib';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { backoff } from '../helpers/index.js';

const log = logger.child('rabbitmq');

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;
type AmqpChannel = Awaited<ReturnType<AmqpConnection['createChannel']>>;

type TopologyFn = (channel: AmqpChannel) => Promise<void>;

interface ConsumerDescriptor {
  queue: string;
  handler: (msg: amqp.ConsumeMessage, channel: AmqpChannel) => Promise<void> | void;
  prefetch?: number;
}

class RabbitMQConnection {
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;

  private readonly topologyFns: TopologyFn[] = [];
  private readonly consumers: ConsumerDescriptor[] = [];

  private connecting = false;
  private closed = false;
  private attempt = 0;

  /** Establish the connection (with retries) and bring up the channel + consumers. */
  async connect(): Promise<void> {
    if (this.connecting || this.connection) return;
    this.connecting = true;
    this.closed = false;
    try {
      await this.establish();
    } finally {
      this.connecting = false;
    }
  }

  private async establish(): Promise<void> {
    try {
      log.info(`connecting to ${config.RABBITMQ_URL}`);
      this.connection = await amqp.connect(config.RABBITMQ_URL);
      this.attempt = 0;

      this.connection.on('error', (err) => log.error('connection error', err.message));
      this.connection.on('close', () => {
        if (this.closed) return;
        log.warn('connection closed — scheduling reconnect');
        this.connection = null;
        this.channel = null;
        this.scheduleReconnect();
      });

      await this.setupChannel();
      log.info('connected, channel and consumers ready');
    } catch (err) {
      log.error('failed to connect', (err as Error).message);
      this.connection = null;
      this.scheduleReconnect();
    }
  }

  /** Create the channel, re-declare the topology and re-subscribe consumers. */
  private async setupChannel(): Promise<void> {
    if (!this.connection) throw new Error('no connection');
    const channel = await this.connection.createChannel();
    await channel.prefetch(config.RABBITMQ_PREFETCH);

    channel.on('error', (err) => log.error('channel error', err.message));
    channel.on('close', () => {
      if (this.closed || !this.connection) return;
      // The channel dropped but the connection is alive — recreate the channel and consumers.
      log.warn('channel closed — recreating');
      this.channel = null;
      void this.setupChannel().catch((err) =>
        // Usually means the connection is going away too — the reconnect at the
        // connection.on('close') level will bring everything back up. So not error.
        log.warn('failed to recreate channel (reconnect will recover)', (err as Error).message),
      );
    });

    this.channel = channel;

    for (const fn of this.topologyFns) await fn(channel);
    for (const c of this.consumers) await this.subscribe(c);
  }

  private async subscribe(c: ConsumerDescriptor): Promise<void> {
    if (!this.channel) return;
    const channel = this.channel;
    if (c.prefetch) await channel.prefetch(c.prefetch);
    await channel.consume(c.queue, (msg) => {
      if (!msg) return; // consumer cancelled by the broker
      void Promise.resolve(c.handler(msg, channel)).catch((err) => {
        log.error(`error handling message from ${c.queue}`, (err as Error).message);
        channel.nack(msg, false, false); // to dead-letter / drop
      });
    });
    log.info(`subscribed to queue ${c.queue}`);
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = backoff(this.attempt++);
    log.info(`reconnect in ${delay}ms (attempt ${this.attempt})`);
    setTimeout(() => void this.establish(), delay).unref();
  }

  /** Declares exchange/queue. Runs on every (re)connect. */
  async registerTopology(fn: TopologyFn): Promise<void> {
    this.topologyFns.push(fn);
    if (this.channel) await fn(this.channel);
  }

  /** Registers a consumer. Re-subscribes automatically after a reconnect. */
  async addConsumer(desc: ConsumerDescriptor): Promise<void> {
    this.consumers.push(desc);
    if (this.channel) await this.subscribe(desc);
  }

  /** Publishes to a queue. Persistent by default. */
  publish(queue: string, payload: unknown, options?: amqp.Options.Publish): boolean {
    if (!this.channel) {
      log.error(`publish to ${queue}: channel unavailable`);
      return false;
    }
    const buf = Buffer.from(JSON.stringify(payload));
    return this.channel.sendToQueue(queue, buf, { persistent: true, ...options });
  }

  isReady(): boolean {
    return this.channel !== null;
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (err) {
      log.error('error while closing', (err as Error).message);
    }
    this.channel = null;
    this.connection = null;
    log.info('closed');
  }
}

export const rabbitmq = new RabbitMQConnection();
export type { AmqpChannel };
