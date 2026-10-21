import { DEMO_PAYMENT_TTL_MS, DemoServer } from './demoServer';

/** Small client for the in-browser demo API, with a controllable clock. */
function setup() {
  let now = Date.parse('2026-10-01T12:00:00Z');
  const server = new DemoServer({ now: () => now, storage: null });
  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; key?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.key) headers['idempotency-key'] = opts.key;
    return server.handle({ method, url: new URL(`http://demo/api${path}`), headers, body: opts.body });
  };
  const login = async (username: string, password: string) => {
    const res = await call('POST', '/auth/login', { body: { username, password } });
    return (res.body as { accessToken: string }).accessToken;
  };
  return { server, call, login, advance: (ms: number) => (now += ms) };
}

// Seed data: product 8 is the "Flash-Sale Desk Lamp" with 3 in stock, sold by demo-seller.
const LAMP = 8;

describe('demo server', () => {
  it('hides pending products from the public catalogue', async () => {
    const { call } = setup();
    const res = await call('GET', '/products?pageSize=50');
    const items = (res.body as { items: Array<{ status: string }> }).items;
    expect(items.length).toBe(8);
    expect(items.every((p) => p.status === 'APPROVED')).toBe(true);
  });

  it('never sells more than the stock', async () => {
    const { call, login, server } = setup();
    const buyer = await login('demo-buyer', 'demo-buyer-pass');
    const tooMany = await call('POST', '/orders', {
      token: buyer,
      key: 'key-too-many',
      body: { items: [{ productId: LAMP, quantity: 4 }] },
    });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', available: 3 });

    for (const key of ['key-a-000', 'key-b-000', 'key-c-000']) {
      const r = await call('POST', '/orders', { token: buyer, key, body: { items: [{ productId: LAMP, quantity: 1 }] } });
      expect(r.status).toBe(201);
    }
    const fourth = await call('POST', '/orders', { token: buyer, key: 'key-d-000', body: { items: [{ productId: LAMP, quantity: 1 }] } });
    expect(fourth.status).toBe(409);
    expect(server.stockOf(LAMP)).toBe(0);
  });

  it('replays the same order for a repeated Idempotency-Key and rejects a changed body', async () => {
    const { call, login, server } = setup();
    const buyer = await login('demo-buyer', 'demo-buyer-pass');
    const body = { items: [{ productId: LAMP, quantity: 2 }] };
    const first = await call('POST', '/orders', { token: buyer, key: 'same-key-1', body });
    const again = await call('POST', '/orders', { token: buyer, key: 'same-key-1', body });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.headers).toEqual({ 'Idempotent-Replayed': 'true' });
    expect((again.body as { id: string }).id).toBe((first.body as { id: string }).id);
    expect(server.stockOf(LAMP)).toBe(1);

    const changed = await call('POST', '/orders', {
      token: buyer,
      key: 'same-key-1',
      body: { items: [{ productId: LAMP, quantity: 1 }] },
    });
    expect(changed.status).toBe(422);
  });

  it('walks the state machine with the right roles and actions', async () => {
    const { call, login } = setup();
    const buyer = await login('demo-buyer', 'demo-buyer-pass');
    const seller = await login('demo-seller', 'demo-seller-pass');
    const placed = await call('POST', '/orders', { token: buyer, key: 'flow-key-1', body: { items: [{ productId: LAMP, quantity: 1 }] } });
    const id = (placed.body as { id: string; actions: string[] }).id;
    expect((placed.body as { actions: string[] }).actions).toEqual(['PAY', 'CANCEL']);

    expect((await call('POST', `/orders/${id}/ship`, { token: seller })).status).toBe(409);
    expect((await call('POST', `/orders/${id}/pay`, { token: seller })).status).toBe(403);
    expect((await call('POST', `/orders/${id}/pay`, { token: buyer })).status).toBe(200);
    expect((await call('POST', `/orders/${id}/cancel`, { token: buyer })).status).toBe(409);

    const sellerView = await call('GET', `/orders/${id}`, { token: seller });
    expect((sellerView.body as { actions: string[] }).actions).toEqual(['SHIP']);
    expect((await call('POST', `/orders/${id}/ship`, { token: seller })).status).toBe(200);
    const done = await call('POST', `/orders/${id}/confirm`, { token: buyer });
    expect(done.body).toMatchObject({ status: 'COMPLETED', actions: [] });
  });

  it('expires unpaid orders and releases their stock exactly once', async () => {
    const { call, login, advance, server } = setup();
    const buyer = await login('demo-buyer', 'demo-buyer-pass');
    const placed = await call('POST', '/orders', { token: buyer, key: 'expire-key', body: { items: [{ productId: LAMP, quantity: 3 }] } });
    const id = (placed.body as { id: string }).id;
    expect(server.stockOf(LAMP)).toBe(0);

    advance(DEMO_PAYMENT_TTL_MS + 1);
    const order = await call('GET', `/orders/${id}`, { token: buyer });
    expect(order.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Payment window expired' });
    expect(server.stockOf(LAMP)).toBe(3);
    expect(server.expireOverdue()).toBe(0);
    expect(server.stockOf(LAMP)).toBe(3);
    expect((await call('POST', `/orders/${id}/pay`, { token: buyer })).status).toBe(409);
  });

  it('puts new listings through admin review', async () => {
    const { call, login } = setup();
    const seller = await login('demo-seller', 'demo-seller-pass');
    const admin = await login('admin', 'admin12345');
    const form = new FormData();
    form.append('name', 'Desk Plant');
    form.append('price', '12.5');
    form.append('stock', '4');
    const created = await call('POST', '/products', { token: seller, body: form });
    expect(created.body).toMatchObject({ status: 'PENDING', priceCents: 1250 });
    const id = (created.body as { id: number }).id;

    expect((await call('GET', `/products/${id}`)).status).toBe(404);
    expect((await call('POST', `/admin/products/${id}/approve`, { token: seller })).status).toBe(403);
    expect((await call('POST', `/admin/products/${id}/approve`, { token: admin })).status).toBe(200);
    expect((await call('GET', `/products/${id}`)).status).toBe(200);
  });

  it('rejects files that are not images', async () => {
    const { call, login } = setup();
    const seller = await login('demo-seller', 'demo-seller-pass');
    const form = new FormData();
    form.append('name', 'Sneaky');
    form.append('price', '1');
    form.append('stock', '1');
    form.append('images', new File(['#!/bin/sh'], 'photo.png', { type: 'image/png' }));
    const res = await call('POST', '/products', { token: seller, body: form });
    expect(res.status).toBe(400);
  });
});
