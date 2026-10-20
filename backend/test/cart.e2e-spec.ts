import { approvedProduct, bearer, createTestApp, loginAdmin, register, TestContext } from './helpers';

describe('Cart (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let seller: { token: string };
  let buyer: { token: string };
  let p1: number;
  let p2: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await loginAdmin(ctx);
    seller = await register(ctx, 'SELLER');
    buyer = await register(ctx, 'BUYER');
    p1 = await approvedProduct(ctx, seller.token, admin, { price: '12.50', stock: 5 });
    p2 = await approvedProduct(ctx, seller.token, admin, { price: '3.00', stock: 100 });
  });
  afterAll(() => ctx.close());

  it('adds items, merging repeated adds into one line', async () => {
    await ctx.http().post('/api/cart/items').set(bearer(buyer.token)).send({ productId: p1, quantity: 1 }).expect(200);
    const res = await ctx
      .http()
      .post('/api/cart/items')
      .set(bearer(buyer.token))
      .send({ productId: p1, quantity: 2 })
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ productId: p1, quantity: 3, available: true, subtotalCents: 3750 });
    expect(res.body.totalCents).toBe(3750);
  });

  it('updates quantity and computes totals', async () => {
    await ctx.http().post('/api/cart/items').set(bearer(buyer.token)).send({ productId: p2, quantity: 4 }).expect(200);
    const res = await ctx
      .http()
      .patch(`/api/cart/items/${p1}`)
      .set(bearer(buyer.token))
      .send({ quantity: 2 })
      .expect(200);
    expect(res.body.totalCents).toBe(2 * 1250 + 4 * 300);
  });

  it('flags lines that exceed current stock as unavailable', async () => {
    const res = await ctx
      .http()
      .patch(`/api/cart/items/${p1}`)
      .set(bearer(buyer.token))
      .send({ quantity: 6 })
      .expect(200);
    const line = res.body.items.find((i: { productId: number }) => i.productId === p1);
    expect(line.available).toBe(false);
    expect(res.body.totalCents).toBe(4 * 300);
  });

  it('refuses products that are not on sale', async () => {
    const pending = await ctx
      .http()
      .post('/api/products')
      .set(bearer(seller.token))
      .field('name', 'Unreviewed')
      .field('price', '1')
      .field('stock', '1')
      .expect(201);
    await ctx
      .http()
      .post('/api/cart/items')
      .set(bearer(buyer.token))
      .send({ productId: pending.body.id, quantity: 1 })
      .expect(404);
  });

  it('validates quantities', async () => {
    await ctx.http().post('/api/cart/items').set(bearer(buyer.token)).send({ productId: p1, quantity: 0 }).expect(400);
    await ctx.http().post('/api/cart/items').set(bearer(buyer.token)).send({ productId: p1, quantity: 100 }).expect(400);
  });

  it('removes a line and clears the cart', async () => {
    const res = await ctx.http().delete(`/api/cart/items/${p2}`).set(bearer(buyer.token)).expect(200);
    expect(res.body.items.map((i: { productId: number }) => i.productId)).toEqual([p1]);
    await ctx.http().delete('/api/cart').set(bearer(buyer.token)).expect(204);
    const empty = await ctx.http().get('/api/cart').set(bearer(buyer.token)).expect(200);
    expect(empty.body).toEqual({ items: [], totalCents: 0 });
  });

  it('keeps carts separate per user', async () => {
    const other = await register(ctx, 'BUYER');
    await ctx.http().post('/api/cart/items').set(bearer(other.token)).send({ productId: p2, quantity: 1 }).expect(200);
    const mine = await ctx.http().get('/api/cart').set(bearer(buyer.token)).expect(200);
    expect(mine.body.items).toHaveLength(0);
  });
});
