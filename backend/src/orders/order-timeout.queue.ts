import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConnectionOptions, Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export const ORDER_TIMEOUT_QUEUE = 'order-timeout';

export interface OrderTimeoutJob {
  orderId: string;
}

/** BullMQ wants its own connections (blocking commands, no retry limit). */
export function bullConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * Producer side of the payment-timeout mechanism: one delayed job per order,
 * keyed by order id so scheduling is itself idempotent.
 */
@Injectable()
export class OrderTimeoutQueue implements OnModuleDestroy {
  private readonly logger = new Logger(OrderTimeoutQueue.name);
  private readonly queue: Queue<OrderTimeoutJob>;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.queue = new Queue<OrderTimeoutJob>(ORDER_TIMEOUT_QUEUE, {
      connection: bullConnection(cfg.redisUrl),
    });
    this.queue.on('error', (err) => this.logger.warn(`Queue error: ${err.message}`));
  }

  async schedule(orderId: string, expiresAt: Date): Promise<void> {
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    try {
      await this.queue.add(
        'expire',
        { orderId },
        {
          jobId: orderId,
          delay,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    } catch (err) {
      // Not fatal: the periodic sweeper cancels overdue orders even without a job.
      this.logger.warn(`Could not schedule timeout for ${orderId}: ${(err as Error).message}`);
    }
  }

  /** Best effort: drop the pending job once the order has been paid or cancelled. */
  async cancel(orderId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(orderId);
      await job?.remove();
    } catch {
      // Job is running or already gone; the handler is a no-op for non-pending orders.
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
