import { fingerprint, IdempotencyService, normalizeLines } from './idempotency.service';

describe('normalizeLines / fingerprint', () => {
  it('merges duplicate products and sorts by id', () => {
    expect(
      normalizeLines([
        { productId: 9, quantity: 1 },
        { productId: 2, quantity: 3 },
        { productId: 9, quantity: 2 },
      ]),
    ).toEqual([
      { productId: 2, quantity: 3 },
      { productId: 9, quantity: 3 },
    ]);
  });

  it('gives equivalent requests the same fingerprint', () => {
    const a = fingerprint([
      { productId: 1, quantity: 2 },
      { productId: 5, quantity: 1 },
    ]);
    const b = fingerprint([
      { productId: 5, quantity: 1 },
      { productId: 1, quantity: 1 },
      { productId: 1, quantity: 1 },
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives different requests different fingerprints', () => {
    expect(fingerprint([{ productId: 1, quantity: 2 }])).not.toBe(
      fingerprint([{ productId: 1, quantity: 3 }]),
    );
  });
});

/** Minimal in-memory stand-in for the few Redis commands the service uses. */
class FakeRedis {
  store = new Map<string, string>();
  down = false;

  async set(key: string, value: string, ...args: unknown[]) {
    if (this.down) throw new Error('connection refused');
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string) {
    if (this.down) throw new Error('connection refused');
    return this.store.get(key) ?? null;
  }
  async del(key: string) {
    this.store.delete(key);
    return 1;
  }
}

describe('IdempotencyService', () => {
  let redis: FakeRedis;
  let service: IdempotencyService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new IdempotencyService(redis as never);
  });

  it('lets the first request through and blocks a concurrent duplicate', async () => {
    expect(await service.claim(1, 'key-0001', 'h1')).toEqual({ state: 'new' });
    expect(await service.claim(1, 'key-0001', 'h1')).toEqual({ state: 'in_progress' });
  });

  it('replays the stored order once completed', async () => {
    await service.claim(1, 'key-0001', 'h1');
    await service.complete(1, 'key-0001', 'h1', 'order-uuid');
    expect(await service.claim(1, 'key-0001', 'h1')).toEqual({ state: 'done', orderId: 'order-uuid' });
  });

  it('rejects the same key with a different payload', async () => {
    await service.claim(1, 'key-0001', 'h1');
    expect(await service.claim(1, 'key-0001', 'h2')).toEqual({ state: 'mismatch' });
  });

  it('scopes keys per user', async () => {
    await service.claim(1, 'key-0001', 'h1');
    expect(await service.claim(2, 'key-0001', 'h1')).toEqual({ state: 'new' });
  });

  it('allows a retry after release', async () => {
    await service.claim(1, 'key-0001', 'h1');
    await service.release(1, 'key-0001');
    expect(await service.claim(1, 'key-0001', 'h1')).toEqual({ state: 'new' });
  });

  it('degrades to "new" when Redis is down (the DB constraint still protects us)', async () => {
    redis.down = true;
    expect(await service.claim(1, 'key-0001', 'h1')).toEqual({ state: 'new' });
  });
});
