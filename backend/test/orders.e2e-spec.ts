import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  approvedProduct,
  bearer,
  createTestApp,
  loginAdmin,
  placeOrder,
  register,
  stockOf,
  TestContext,
} from './helpers';

type User = { token: string; id: number };

describe('Orders (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let seller: User;
  let seller2: User;
  let buyer: User;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await loginAdmin(ctx);
    seller = await register(ctx, 'SELLER');
    seller2 = await register(ctx, 'SELLER');
    buyer = await register(ctx, 'BUYER');
  });
  afterAll(() => ctx.close());

  describe('placing an order', () => {
    it('deducts stock, snapshots prices and clears the purchased cart lines', async () => {
      const a = await approvedProduct(ctx, seller.token, admin, { name: 'Mug', price: '8.50', stock: 10 });
      const b = await approvedProduct(ctx, seller.token, admin, { name: 'Tea', price: '4.25', stock: 10 });
      const c = await approvedProduct(ctx, seller.token, admin, { stock: 10 });
      for (const productId of [a, b, c]) {
        await ctx.http().post('/api/cart/items').set(bearer(buyer.token)).send({ productId, quantity: 1 });
      }

      const res = await placeOrder(
        ctx,
        buyer.token,
        [
          { productId: a, quantity: 2 },
          { productId: b, quantity: 3 },
        ],
        undefined,
        { clearCartItems: true },
      ).expect(201);

      expect(res.body).toMatchObject({
        status: 'PENDING_PAYMENT',
        totalCents: 2 * 850 + 3 * 425,
        actions: expect.arrayContaining(['PAY', 'CANCEL']),
      });
      expect(res.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ productId: a, productName: 'Mug', unitPriceCents: 850, quantity: 2 }),
          expect.objectContaining({ productId: b, productName: 'Tea', unitPriceCents: 425, quantity: 3 }),
        ]),
      );
      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 800_000);
      expect(await stockOf(ctx, a)).toBe(8);
      expect(await stockOf(ctx, b)).toBe(7);

      const cart = await ctx.http().get('/api/cart').set(bearer(buyer.token)).expect(200);
      expect(cart.body.items.map((i: { productId: number }) => i.productId)).toEqual([c]);
    });

    it('requires a well-formed Idempotency-Key header', async () => {
      const p = await approvedProduct(ctx, seller.token, admin);
      const res = await ctx
        .http()
        .post('/api/orders')
        .set(bearer(buyer.token))
        .send({ items: [{ productId: p, quantity: 1 }] })
        .expect(400);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 1 }], 'short').expect(400);
    });

    it('is all-or-nothing: one short line rolls back the others', async () => {
      const plenty = await approvedProduct(ctx, seller.token, admin, { stock: 50 });
      const scarce = await approvedProduct(ctx, seller.token, admin, { stock: 1 });
      const res = await placeOrder(ctx, buyer.token, [
        { productId: plenty, quantity: 5 },
        { productId: scarce, quantity: 2 },
      ]).expect(409);
      expect(res.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', productId: scarce, available: 1 });
      expect(await stockOf(ctx, plenty)).toBe(50);
      expect(await stockOf(ctx, scarce)).toBe(1);
      const [{ count }] = await ctx.ds.query(
        `SELECT count(*)::int AS count FROM orders WHERE user_id = $1 AND status = 'PENDING_PAYMENT'`,
        [buyer.id],
      );
      expect(count).toBe(1); // only the order from the first test
    });

    it('refuses products that are not on sale and the seller’s own products', async () => {
      const pending = await ctx
        .http()
        .post('/api/products')
        .set(bearer(seller.token))
        .field('name', 'Unreviewed')
        .field('price', '1')
        .field('stock', '5')
        .expect(201);
      const unavailable = await placeOrder(ctx, buyer.token, [
        { productId: pending.body.id, quantity: 1 },
      ]).expect(409);
      expect(unavailable.body.code).toBe('PRODUCT_UNAVAILABLE');

      const own = await approvedProduct(ctx, seller.token, admin, { stock: 5 });
      const res = await placeOrder(ctx, seller.token, [{ productId: own, quantity: 1 }]).expect(400);
      expect(res.body.code).toBe('OWN_PRODUCT');
      expect(await stockOf(ctx, own)).toBe(5);
    });
  });

  describe('oversell protection', () => {
    it('never sells more than the stock under heavy concurrency', async () => {
      const STOCK = 5;
      const BUYERS = 30;
      const p = await approvedProduct(ctx, seller.token, admin, { stock: STOCK });
      const buyers = await Promise.all(Array.from({ length: BUYERS }, () => register(ctx, 'BUYER')));

      const results = await Promise.all(
        buyers.map((b) => placeOrder(ctx, b.token, [{ productId: p, quantity: 1 }])),
      );

      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(STOCK);
      expect(statuses.filter((s) => s === 409)).toHaveLength(BUYERS - STOCK);
      expect(await stockOf(ctx, p)).toBe(0);

      const [{ sold }] = await ctx.ds.query(
        `SELECT coalesce(sum(quantity), 0)::int AS sold FROM order_items WHERE product_id = $1`,
        [p],
      );
      expect(sold).toBe(STOCK);
    });

    it('handles concurrent multi-item orders over overlapping products without deadlock or oversell', async () => {
      const x = await approvedProduct(ctx, seller.token, admin, { stock: 10 });
      const y = await approvedProduct(ctx, seller.token, admin, { stock: 10 });
      const buyers = await Promise.all(Array.from({ length: 12 }, () => register(ctx, 'BUYER')));

      // Half list the products as [x, y], half as [y, x]; the server locks in id order regardless.
      const results = await Promise.all(
        buyers.map((b, i) =>
          placeOrder(
            ctx,
            b.token,
            i % 2
              ? [
                  { productId: x, quantity: 1 },
                  { productId: y, quantity: 1 },
                ]
              : [
                  { productId: y, quantity: 1 },
                  { productId: x, quantity: 1 },
                ],
          ),
        ),
      );
      const ok = results.filter((r) => r.status === 201).length;
      expect(ok).toBe(10);
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      expect(await stockOf(ctx, x)).toBe(0);
      expect(await stockOf(ctx, y)).toBe(0);
    });
  });

  describe('idempotency', () => {
    it('creates exactly one order when the same request is fired many times at once', async () => {
      const p = await approvedProduct(ctx, seller.token, admin, { stock: 100 });
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => placeOrder(ctx, buyer.token, [{ productId: p, quantity: 2 }], key)),
      );

      const created = results.filter((r) => r.status === 201);
      expect(created).toHaveLength(1);
      // Others are either replays of the same order or told to retry.
      for (const r of results.filter((x) => x.status !== 201)) {
        expect([200, 409]).toContain(r.status);
        if (r.status === 200) expect(r.body.id).toBe(created[0].body.id);
        if (r.status === 409) expect(r.body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
      }
      expect(await stockOf(ctx, p)).toBe(98);
      const [{ count }] = await ctx.ds.query(
        `SELECT count(*)::int AS count FROM orders WHERE idempotency_key = $1`,
        [key],
      );
      expect(count).toBe(1);
    });

    it('replays the original order for a sequential retry', async () => {
      const p = await approvedProduct(ctx, seller.token, admin, { stock: 10 });
      const key = randomUUID();
      const first = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 1 }], key).expect(201);
      const retry = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 1 }], key).expect(200);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body.id).toBe(first.body.id);
      expect(await stockOf(ctx, p)).toBe(9);
    });

    it('rejects reusing a key for a different request', async () => {
      const p = await approvedProduct(ctx, seller.token, admin, { stock: 10 });
      const key = randomUUID();
      await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 1 }], key).expect(201);
      const res = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 3 }], key).expect(422);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('scopes keys per user', async () => {
      const p = await approvedProduct(ctx, seller.token, admin, { stock: 10 });
      const other = await register(ctx, 'BUYER');
      const key = randomUUID();
      const a = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 1 }], key).expect(201);
      const b = await placeOrder(ctx, other.token, [{ productId: p, quantity: 1 }], key).expect(201);
      expect(a.body.id).not.toBe(b.body.id);
    });

    it('still deduplicates when Redis has lost the key (database constraint)', async () => {
      const p = await approvedProduct(ctx, seller.token, admin, { stock: 10 });
      const key = randomUUID();
      const first = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 1 }], key).expect(201);

      const redis = new Redis(process.env.REDIS_URL as string);
      await redis.del(`idem:order:${buyer.id}:${key}`);
      await redis.quit();

      const retry = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 1 }], key).expect(200);
      expect(retry.body.id).toBe(first.body.id);
      expect(await stockOf(ctx, p)).toBe(9);
    });

    it('lets a client retry with the same key after a failure', async () => {
      const p = await approvedProduct(ctx, seller.token, admin, { stock: 1 });
      const key = randomUUID();
      await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 2 }], key).expect(409);
      await ctx.http().post(`/api/products/${p}/stock`).set(bearer(seller.token)).send({ delta: 5 }).expect(200);
      await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 2 }], key).expect(201);
    });
  });

  describe('state machine', () => {
    async function freshOrder(qty = 2, owner: User = seller) {
      const p = await approvedProduct(ctx, owner.token, admin, { stock: 10 });
      const res = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: qty }]).expect(201);
      return { id: res.body.id as string, productId: p };
    }

    it('goes PENDING_PAYMENT → PAID → SHIPPED → COMPLETED with audit log', async () => {
      const { id } = await freshOrder();
      const paid = await ctx.http().post(`/api/orders/${id}/pay`).set(bearer(buyer.token)).expect(200);
      expect(paid.body).toMatchObject({ status: 'PAID', actions: [] });
      expect(paid.body.paidAt).toEqual(expect.any(String));

      const sellerView = await ctx.http().get(`/api/orders/${id}`).set(bearer(seller.token)).expect(200);
      expect(sellerView.body.actions).toEqual(['SHIP']);

      await ctx.http().post(`/api/orders/${id}/ship`).set(bearer(seller.token)).expect(200);
      const done = await ctx.http().post(`/api/orders/${id}/confirm`).set(bearer(buyer.token)).expect(200);
      expect(done.body.status).toBe('COMPLETED');

      const log = await ctx.ds.query(
        `SELECT from_status, to_status, event FROM order_status_logs WHERE order_id = $1 ORDER BY id`,
        [id],
      );
      expect(log.map((l: { event: string }) => l.event)).toEqual(['CREATE', 'PAY', 'SHIP', 'CONFIRM']);
    });

    it('rejects illegal transitions with 409', async () => {
      const { id } = await freshOrder();
      const early = await ctx.http().post(`/api/orders/${id}/confirm`).set(bearer(buyer.token)).expect(409);
      expect(early.body).toMatchObject({ code: 'ILLEGAL_TRANSITION', status: 'PENDING_PAYMENT' });
      await ctx.http().post(`/api/orders/${id}/ship`).set(bearer(seller.token)).expect(409);

      await ctx.http().post(`/api/orders/${id}/pay`).set(bearer(buyer.token)).expect(200);
      await ctx.http().post(`/api/orders/${id}/pay`).set(bearer(buyer.token)).expect(409);
      const cancel = await ctx.http().post(`/api/orders/${id}/cancel`).set(bearer(buyer.token)).expect(409);
      expect(cancel.body.code).toBe('ILLEGAL_TRANSITION');
    });

    it('enforces who may do what', async () => {
      const { id } = await freshOrder();
      const stranger = await register(ctx, 'BUYER');
      await ctx.http().get(`/api/orders/${id}`).set(bearer(stranger.token)).expect(404);
      await ctx.http().post(`/api/orders/${id}/pay`).set(bearer(stranger.token)).expect(404);
      await ctx.http().post(`/api/orders/${id}/pay`).set(bearer(seller.token)).expect(403);
      await ctx.http().post(`/api/orders/${id}/pay`).set(bearer(buyer.token)).expect(200);
      await ctx.http().post(`/api/orders/${id}/ship`).set(bearer(buyer.token)).expect(403);
      await ctx.http().post(`/api/orders/${id}/ship`).set(bearer(seller2.token)).expect(404);
      await ctx.http().post(`/api/orders/${id}/ship`).set(bearer(admin)).expect(200);
    });

    it('only lets an admin ship an order that spans several sellers', async () => {
      const a = await approvedProduct(ctx, seller.token, admin, { stock: 5 });
      const b = await approvedProduct(ctx, seller2.token, admin, { stock: 5 });
      const res = await placeOrder(ctx, buyer.token, [
        { productId: a, quantity: 1 },
        { productId: b, quantity: 1 },
      ]).expect(201);
      const id = res.body.id;
      await ctx.http().post(`/api/orders/${id}/pay`).set(bearer(buyer.token)).expect(200);
      await ctx.http().post(`/api/orders/${id}/ship`).set(bearer(seller.token)).expect(403);

      // Each seller only sees their own lines in their sales list.
      const sales = await ctx.http().get('/api/orders/sales').set(bearer(seller2.token)).expect(200);
      const order = sales.body.items.find((o: { id: string }) => o.id === id);
      expect(order.items.map((i: { productId: number }) => i.productId)).toEqual([b]);

      await ctx.http().post(`/api/orders/${id}/ship`).set(bearer(admin)).expect(200);
    });

    it('gives stock back when a pending order is cancelled', async () => {
      const { id, productId } = await freshOrder(3);
      expect(await stockOf(ctx, productId)).toBe(7);
      const res = await ctx
        .http()
        .post(`/api/orders/${id}/cancel`)
        .set(bearer(buyer.token))
        .send({ reason: 'Changed my mind' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Changed my mind' });
      expect(await stockOf(ctx, productId)).toBe(10);
      // Cancelling twice must not release stock twice.
      await ctx.http().post(`/api/orders/${id}/cancel`).set(bearer(buyer.token)).expect(409);
      expect(await stockOf(ctx, productId)).toBe(10);
    });

    it('lets exactly one of a racing pay and cancel win', async () => {
      for (let i = 0; i < 5; i++) {
        const { id, productId } = await freshOrder(2);
        const [pay, cancel] = await Promise.all([
          ctx.http().post(`/api/orders/${id}/pay`).set(bearer(buyer.token)),
          ctx.http().post(`/api/orders/${id}/cancel`).set(bearer(buyer.token)),
        ]);
        expect([pay.status, cancel.status].sort()).toEqual([200, 409]);
        const final = await ctx.http().get(`/api/orders/${id}`).set(bearer(buyer.token)).expect(200);
        expect(await stockOf(ctx, productId)).toBe(final.body.status === 'PAID' ? 8 : 10);
      }
    });

    it('lists the buyer’s orders with a status filter, and all orders for admins', async () => {
      const mine = await ctx.http().get('/api/orders?status=COMPLETED').set(bearer(buyer.token)).expect(200);
      expect(mine.body.items.length).toBeGreaterThan(0);
      expect(mine.body.items.every((o: { status: string }) => o.status === 'COMPLETED')).toBe(true);

      const all = await ctx.http().get('/api/admin/orders?pageSize=50').set(bearer(admin)).expect(200);
      expect(all.body.total).toBeGreaterThan(mine.body.total);
      await ctx.http().get('/api/admin/orders').set(bearer(buyer.token)).expect(403);
    });
  });
});
