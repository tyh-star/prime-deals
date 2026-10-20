import {
  approvedProduct,
  bearer,
  createTestApp,
  loginAdmin,
  PNG,
  register,
  stockOf,
  TestContext,
} from './helpers';

describe('Catalogue, seller uploads and admin review (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let seller: { token: string; id: number };
  let otherSeller: { token: string; id: number };
  let buyer: { token: string; id: number };

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await loginAdmin(ctx);
    seller = await register(ctx, 'SELLER');
    otherSeller = await register(ctx, 'SELLER');
    buyer = await register(ctx, 'BUYER');
  });
  afterAll(() => ctx.close());

  let productId: number;

  it('lets a seller upload a product with images; it starts PENDING and hidden', async () => {
    const res = await ctx
      .http()
      .post('/api/products')
      .set(bearer(seller.token))
      .field('name', 'Vintage Camera')
      .field('description', 'Fully working film camera')
      .field('price', '149.90')
      .field('stock', '4')
      .field('category', 'Photo')
      .attach('images', PNG, 'front.png')
      .attach('images', PNG, 'back.png')
      .expect(201);

    productId = res.body.id;
    expect(res.body).toMatchObject({
      name: 'Vintage Camera',
      priceCents: 14990,
      stock: 4,
      status: 'PENDING',
      sellerId: seller.id,
    });
    expect(res.body.images).toHaveLength(2);

    // The stored image is served back.
    await ctx.http().get(res.body.images[0]).expect(200).expect('Content-Type', /png/);

    const list = await ctx.http().get('/api/products').expect(200);
    expect(list.body.items.map((p: { id: number }) => p.id)).not.toContain(productId);
    await ctx.http().get(`/api/products/${productId}`).expect(404);
    await ctx.http().get(`/api/products/${productId}`).set(bearer(buyer.token)).expect(404);
    await ctx.http().get(`/api/products/${productId}`).set(bearer(seller.token)).expect(200);
  });

  it('rejects uploads that are not really images', async () => {
    const res = await ctx
      .http()
      .post('/api/products')
      .set(bearer(seller.token))
      .field('name', 'Sneaky')
      .field('price', '1.00')
      .field('stock', '1')
      .attach('images', Buffer.from('#!/bin/sh\nrm -rf /'), 'photo.png')
      .expect(400);
    expect(res.body.message).toMatch(/not a JPEG, PNG or WebP/);
  });

  it('validates price format', async () => {
    for (const price of ['abc', '1.999', '0', '-5']) {
      await ctx
        .http()
        .post('/api/products')
        .set(bearer(seller.token))
        .field('name', 'Bad price')
        .field('price', price)
        .field('stock', '1')
        .expect(400);
    }
  });

  it('shows the product publicly once an admin approves it', async () => {
    const queue = await ctx.http().get('/api/admin/products?status=PENDING').set(bearer(admin)).expect(200);
    expect(queue.body.items.map((p: { id: number }) => p.id)).toContain(productId);
    expect(queue.body.items[0].seller).toEqual({ id: seller.id, username: expect.any(String) });

    const approved = await ctx
      .http()
      .post(`/api/admin/products/${productId}/approve`)
      .set(bearer(admin))
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');

    const detail = await ctx.http().get(`/api/products/${productId}`).expect(200);
    expect(detail.body.seller).toEqual({ id: seller.id, username: expect.any(String) });
    expect(detail.body.seller.phone).toBeUndefined();

    // A decision can only be made once.
    const again = await ctx
      .http()
      .post(`/api/admin/products/${productId}/reject`)
      .set(bearer(admin))
      .send({ reason: 'changed my mind' })
      .expect(409);
    expect(again.body.code).toBe('NOT_PENDING');
  });

  it('records a rejection reason the seller can see', async () => {
    const res = await ctx
      .http()
      .post('/api/products')
      .set(bearer(seller.token))
      .field('name', 'Counterfeit Watch')
      .field('price', '20')
      .field('stock', '1')
      .expect(201);
    await ctx
      .http()
      .post(`/api/admin/products/${res.body.id}/reject`)
      .set(bearer(admin))
      .send({ reason: 'Brand infringement' })
      .expect(200);
    const mine = await ctx.http().get('/api/products/mine').set(bearer(seller.token)).expect(200);
    const rejected = mine.body.items.find((p: { id: number }) => p.id === res.body.id);
    expect(rejected).toMatchObject({ status: 'REJECTED', reviewNote: 'Brand infringement' });
  });

  it('sends an edited product back to review, and only its owner may edit it', async () => {
    await ctx
      .http()
      .patch(`/api/products/${productId}`)
      .set(bearer(otherSeller.token))
      .field('name', 'Hijacked')
      .expect(403);

    const edited = await ctx
      .http()
      .patch(`/api/products/${productId}`)
      .set(bearer(seller.token))
      .field('price', '139.00')
      .expect(200);
    expect(edited.body).toMatchObject({ status: 'PENDING', priceCents: 13900, stock: 4 });
    await ctx.http().get(`/api/products/${productId}`).expect(404);
    await ctx.http().post(`/api/admin/products/${productId}/approve`).set(bearer(admin)).expect(200);
  });

  it('adjusts stock relatively and never below zero', async () => {
    await ctx
      .http()
      .post(`/api/products/${productId}/stock`)
      .set(bearer(seller.token))
      .send({ delta: 6 })
      .expect(200);
    expect(await stockOf(ctx, productId)).toBe(10);

    const res = await ctx
      .http()
      .post(`/api/products/${productId}/stock`)
      .set(bearer(seller.token))
      .send({ delta: -11 })
      .expect(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(ctx, productId)).toBe(10);
  });

  it('searches by name or category, filters and sorts', async () => {
    await approvedProduct(ctx, seller.token, admin, { name: 'Cheap Lens Cap', price: '2.50', category: 'Photo' });
    await approvedProduct(ctx, seller.token, admin, { name: 'Garden Hose', price: '30', category: 'Garden' });

    const photo = await ctx.http().get('/api/products?q=photo&sort=price_asc').expect(200);
    expect(photo.body.items.map((p: { name: string }) => p.name)).toEqual([
      'Cheap Lens Cap',
      'Vintage Camera',
    ]);

    const byName = await ctx.http().get('/api/products?q=HOSE').expect(200);
    expect(byName.body.total).toBe(1);

    // LIKE wildcards in user input are treated literally.
    const wildcard = await ctx.http().get('/api/products?q=%25').expect(200);
    expect(wildcard.body.total).toBe(0);

    const garden = await ctx.http().get('/api/products?category=Garden').expect(200);
    expect(garden.body.items).toHaveLength(1);

    const cats = await ctx.http().get('/api/products/categories').expect(200);
    expect(cats.body).toEqual(['Garden', 'Photo']);

    const paged = await ctx.http().get('/api/products?pageSize=1&page=2&sort=price_desc').expect(200);
    expect(paged.body).toMatchObject({ total: 3, page: 2, pageSize: 1 });
    expect(paged.body.items[0].name).toBe('Garden Hose');
  });

  it('archives a product so it disappears from the catalogue', async () => {
    const id = await approvedProduct(ctx, seller.token, admin, { name: 'Old Stock' });
    await ctx.http().delete(`/api/products/${id}`).set(bearer(otherSeller.token)).expect(403);
    await ctx.http().delete(`/api/products/${id}`).set(bearer(seller.token)).expect(204);
    await ctx.http().get(`/api/products/${id}`).expect(404);
  });
});
