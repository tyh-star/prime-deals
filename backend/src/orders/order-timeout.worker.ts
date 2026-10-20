import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { bullConnection, ORDER_TIMEOUT_QUEUE, OrderTimeoutJob } from './order-timeout.queue';
import { ExpireResult, OrdersService } from './orders.service';

/**
 * Consumer side of payment timeouts, with two independent mechanisms:
 *  - a BullMQ worker that runs each order's delayed job right when it is due, and
 *  - a periodic sweep that catches anything the queue lost.
 * Both call the same idempotent `OrdersService.expire`, and the compare-and-set in
 * the state machine guarantees an order is cancelled (and its stock released) once.
 */
@Injectable()
export class OrderTimeoutWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderTimeoutWorker.name);
  private worker?: Worker<OrderTimeoutJob, ExpireResult>;
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly orders: OrdersService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<OrderTimeoutJob, ExpireResult>(
      ORDER_TIMEOUT_QUEUE,
      async (job: Job<OrderTimeoutJob>) => {
        const result = await this.orders.expire(job.data.orderId);
        // Redis and Postgres clocks can disagree slightly; let BullMQ retry with backoff.
        if (result === 'not_due') throw new Error(`Order ${job.data.orderId} not due yet`);
        if (result === 'cancelled') this.logger.log(`Order ${job.data.orderId} expired and was cancelled`);
        return result;
      },
      { connection: bullConnection(this.cfg.redisUrl), concurrency: 5 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`Timeout job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
    this.worker.on('error', (err) => this.logger.warn(`Worker error: ${err.message}`));

    this.timer = setInterval(() => void this.sweep(), this.cfg.orderSweepIntervalMs);
    this.timer.unref();
  }

  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const cancelled = await this.orders.expireOverdue();
      if (cancelled) this.logger.log(`Sweeper cancelled ${cancelled} overdue order(s)`);
      return cancelled;
    } catch (err) {
      this.logger.warn(`Sweep failed: ${(err as Error).message}`);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }
}
