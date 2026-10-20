import { OrderTimeoutQueue } from '../src/orders/order-timeout.queue';
import { OrderTimeoutWorker } from '../src/orders/order-timeout.worker';
import {
  approvedProduct,
  bearer,
  createTestApp,
  loginAdmin,
  placeOrder,
  register,
  sleep,
  stockOf,
  TestContext,
  waitFor,
} from './helpers';

describe('Payment timeout (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let seller: { token: string };
  let buyer: { token: string; id: number };

  beforeAll(async () => {
    ctx = await createTestApp({ ORDER_PAYMENT_TTL_SECONDS: '2' });
    admin = await loginAdmin(ctx);
    seller = await register(ctx, 'SELLER');
    buyer = await register(ctx, 'BUYER');
  });
  afterAll(() => ctx.close());

  async function statusOf(id: string): Promise<string> {
    const res = await ctx.http().get(`/api/orders/${id}`).set(bearer(buyer.token)).expect(200);
    return res.body.status;
  }

  it('cancels an unpaid order when its delayed job fires and releases the stock', async () => {
    const p = await approvedProduct(ctx, seller.token, admin, { stock: 4 });
    const res = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 3 }]).expect(201);
    const id = res.body.id;
    expect(await stockOf(ctx, p)).toBe(1);

    await waitFor(async () => (await statusOf(id)) === 'CANCELLED', 20000);
    expect(await stockOf(ctx, p)).toBe(4);

    const order = await ctx.http().get(`/api/orders/${id}`).set(bearer(buyer.token)).expect(200);
    expect(order.body.cancelReason).toBe('Payment window expired');
    const [log] = await ctx.ds.query(
      `SELECT event, actor_id FROM order_status_logs WHERE order_id = $1 AND event = 'EXPIRE'`,
      [id],
    );
    expect(log).toEqual({ event: 'EXPIRE', actor_id: null });
  });

  it('does not touch an order that was paid in time', async () => {
    const p = await approvedProduct(ctx, seller.token, admin, { stock: 4 });
    const res = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 1 }]).expect(201);
    await ctx.http().post(`/api/orders/${res.body.id}/pay`).set(bearer(buyer.token)).expect(200);
    await sleep(3000);
    expect(await statusOf(res.body.id)).toBe('PAID');
    expect(await stockOf(ctx, p)).toBe(3);
  });

  it('refuses payment after the window closes, and the sweeper catches orders whose job was lost', async () => {
    const p = await approvedProduct(ctx, seller.token, admin, { stock: 4 });
    const res = await placeOrder(ctx, buyer.token, [{ productId: p, quantity: 2 }]).expect(201);
    const id = res.body.id;
    // Simulate a lost job (e.g. Redis flushed).
    await ctx.app.get(OrderTimeoutQueue).cancel(id);
    await sleep(2500);

    const late = await ctx.http().post(`/api/orders/${id}/pay`).set(bearer(buyer.token)).expect(409);
    expect(late.body.code).toBe('ORDER_EXPIRED');
    expect(await statusOf(id)).toBe('PENDING_PAYMENT');

    const worker = ctx.app.get(OrderTimeoutWorker);
    expect(await worker.sweep()).toBeGreaterThanOrEqual(1);
    expect(await statusOf(id)).toBe('CANCELLED');
    expect(await stockOf(ctx, p)).toBe(4);

    // Sweeping again is a no-op: stock is released exactly once.
    expect(await worker.sweep()).toBe(0);
    expect(await stockOf(ctx, p)).toBe(4);
  });
});
