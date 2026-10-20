import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export interface OrderLine {
  productId: number;
  quantity: number;
}

/**
 * Merges duplicate products and sorts by id, so `[{1,x2}]` and `[{1,x1},{1,x1}]`
 * describe the same purchase, and so stock rows are always locked in id order
 * (which prevents deadlocks between concurrent orders).
 */
export function normalizeLines(lines: OrderLine[]): OrderLine[] {
  const merged = new Map<number, number>();
  for (const { productId, quantity } of lines) {
    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }
  return [...merged.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId - b.productId);
}

export function fingerprint(lines: OrderLine[]): string {
  const canonical = normalizeLines(lines)
    .map((l) => `${l.productId}x${l.quantity}`)
    .join(',');
  return createHash('sha256').update(canonical).digest('hex');
}

export type IdempotencyClaim =
  | { state: 'new' }
  | { state: 'done'; orderId: string }
  | { state: 'in_progress' }
  | { state: 'mismatch' };

interface StoredClaim {
  /** P = processing, D = done */
  s: 'P' | 'D';
  /** request fingerprint */
  h: string;
  /** order id once done */
  o?: string;
}

/** How long a "processing" marker blocks duplicates if the request dies mid-flight. */
const PROCESSING_TTL_SECONDS = 30;
/** How long a finished key replays its original response from Redis. */
const DONE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Fast path for idempotent order placement. Redis turns concurrent duplicates
 * away cheaply; the unique (user_id, idempotency_key) index on `orders` is the
 * source of truth, so correctness never depends on Redis being up.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(userId: number, idempotencyKey: string): string {
    return `idem:order:${userId}:${idempotencyKey}`;
  }

  async claim(userId: number, idempotencyKey: string, hash: string): Promise<IdempotencyClaim> {
    const key = this.key(userId, idempotencyKey);
    const marker: StoredClaim = { s: 'P', h: hash };
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const ok = await this.redis.set(
          key,
          JSON.stringify(marker),
          'EX',
          PROCESSING_TTL_SECONDS,
          'NX',
        );
        if (ok === 'OK') return { state: 'new' };
        const raw = await this.redis.get(key);
        if (!raw) continue; // expired between SET and GET — try to claim again
        const stored = JSON.parse(raw) as StoredClaim;
        if (stored.h !== hash) return { state: 'mismatch' };
        if (stored.s === 'D' && stored.o) return { state: 'done', orderId: stored.o };
        return { state: 'in_progress' };
      }
      return { state: 'new' };
    } catch (err) {
      this.logger.warn(`Redis idempotency unavailable, relying on DB constraint: ${(err as Error).message}`);
      return { state: 'new' };
    }
  }

  async complete(userId: number, idempotencyKey: string, hash: string, orderId: string) {
    const value: StoredClaim = { s: 'D', h: hash, o: orderId };
    await this.redis
      .set(this.key(userId, idempotencyKey), JSON.stringify(value), 'EX', DONE_TTL_SECONDS)
      .catch((err: Error) => this.logger.warn(`Could not record idempotency result: ${err.message}`));
  }

  /** Called when the request failed, so the client may retry with the same key. */
  async release(userId: number, idempotencyKey: string) {
    await this.redis
      .del(this.key(userId, idempotencyKey))
      .catch((err: Error) => this.logger.warn(`Could not release idempotency key: ${err.message}`));
  }
}
