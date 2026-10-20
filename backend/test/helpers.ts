import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';

export const ADMIN = { username: 'admin', password: 'admin-password' };

/** Smallest valid PNG header — enough for the magic-byte check. */
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const DEFAULT_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/prime_deals_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret',
  JWT_EXPIRES_IN_SECONDS: '3600',
  ORDER_PAYMENT_TTL_SECONDS: '900',
  // Tests trigger the sweeper explicitly; keep the timer out of the way.
  ORDER_SWEEP_INTERVAL_MS: '3600000',
  UPLOAD_DIR: join(tmpdir(), 'prime-deals-e2e-uploads'),
  CORS_ORIGIN: 'http://localhost:5173',
  ADMIN_USERNAME: ADMIN.username,
  ADMIN_PASSWORD: ADMIN.password,
  SEED_DEMO: 'false',
};

export interface TestContext {
  app: INestApplication;
  ds: DataSource;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/**
 * Boots the full application against a clean database and Redis db.
 * Each spec file gets its own app; files run in band (see package.json).
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestContext> {
  Object.assign(process.env, DEFAULT_ENV, env);

  const redis = new Redis(process.env.REDIS_URL as string);
  await redis.flushdb();
  await redis.quit();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  setupApp(app);
  await app.init(); // runs migrations and bootstraps the admin user

  const ds = app.get(DataSource);
  await ds.query(
    `TRUNCATE order_status_logs, order_items, orders, cart_items, products
     RESTART IDENTITY CASCADE`,
  );
  await ds.query(`DELETE FROM users WHERE username <> $1`, [ADMIN.username]);

  const server = app.getHttpServer();
  return { app, ds, http: () => request(server), close: () => app.close() };
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function register(
  ctx: TestContext,
  role: 'BUYER' | 'SELLER' = 'BUYER',
  username = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}`,
): Promise<{ token: string; id: number; username: string }> {
  const res = await ctx
    .http()
    .post('/api/auth/register')
    .send({ username, password: 'password123', role })
    .expect(201);
  return { token: res.body.accessToken, id: res.body.user.id, username };
}

export async function loginAdmin(ctx: TestContext): Promise<string> {
  const res = await ctx.http().post('/api/auth/login').send(ADMIN).expect(200);
  return res.body.accessToken;
}

/** Seller submits a product and the admin approves it. Returns the product id. */
export async function approvedProduct(
  ctx: TestContext,
  sellerToken: string,
  adminToken: string,
  fields: { name?: string; price?: string; stock?: number; category?: string } = {},
): Promise<number> {
  const res = await ctx
    .http()
    .post('/api/products')
    .set(bearer(sellerToken))
    .field('name', fields.name ?? `Product ${randomUUID().slice(0, 6)}`)
    .field('price', fields.price ?? '10.00')
    .field('stock', String(fields.stock ?? 10))
    .field('category', fields.category ?? 'General')
    .expect(201);
  await ctx
    .http()
    .post(`/api/admin/products/${res.body.id}/approve`)
    .set(bearer(adminToken))
    .expect(200);
  return res.body.id;
}

export async function stockOf(ctx: TestContext, productId: number): Promise<number> {
  const [row] = await ctx.ds.query('SELECT stock FROM products WHERE id = $1', [productId]);
  return row.stock;
}

export function placeOrder(
  ctx: TestContext,
  token: string,
  items: Array<{ productId: number; quantity: number }>,
  key: string = randomUUID(),
  extra: Record<string, unknown> = {},
) {
  return ctx
    .http()
    .post('/api/orders')
    .set(bearer(token))
    .set('Idempotency-Key', key)
    .send({ items, ...extra });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` returns a truthy value or the timeout elapses. */
export async function waitFor<T>(check: () => Promise<T>, timeoutMs = 15000, everyMs = 200) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(everyMs);
  }
}
