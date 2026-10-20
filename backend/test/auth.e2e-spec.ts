import { bearer, createTestApp, register, TestContext } from './helpers';

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('registers, logs in and returns the profile without the password hash', async () => {
    const reg = await ctx
      .http()
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'password123', phone: '416 555 0100' })
      .expect(201);
    expect(reg.body.user).toMatchObject({ username: 'alice', role: 'BUYER' });
    expect(reg.body.user.passwordHash).toBeUndefined();
    expect(reg.body.accessToken).toEqual(expect.any(String));

    const login = await ctx
      .http()
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'password123' })
      .expect(200);
    expect(login.body.user.passwordHash).toBeUndefined();

    const me = await ctx.http().get('/api/auth/me').set(bearer(login.body.accessToken)).expect(200);
    expect(me.body).toMatchObject({ username: 'alice', phone: '416 555 0100' });
  });

  it('stores passwords as bcrypt hashes, not plaintext', async () => {
    const [row] = await ctx.ds.query(`SELECT password_hash FROM users WHERE username = 'alice'`);
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects duplicate usernames, weak input and self-registration as admin', async () => {
    await ctx
      .http()
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'password123' })
      .expect(409);
    await ctx.http().post('/api/auth/register').send({ username: 'bob', password: 'short' }).expect(400);
    await ctx
      .http()
      .post('/api/auth/register')
      .send({ username: 'mallory', password: 'password123', role: 'ADMIN' })
      .expect(400);
  });

  it('gives the same error for unknown user and wrong password', async () => {
    const a = await ctx.http().post('/api/auth/login').send({ username: 'nobody', password: 'x' });
    const b = await ctx.http().post('/api/auth/login').send({ username: 'alice', password: 'wrong' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('locks an account for a while after 5 failed attempts', async () => {
    await register(ctx, 'BUYER', 'victim');
    for (let i = 0; i < 5; i++) {
      await ctx.http().post('/api/auth/login').send({ username: 'victim', password: 'nope' }).expect(401);
    }
    const locked = await ctx
      .http()
      .post('/api/auth/login')
      .send({ username: 'victim', password: 'password123' })
      .expect(429);
    expect(locked.body.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('revokes the token on logout', async () => {
    const { token } = await register(ctx);
    await ctx.http().get('/api/auth/me').set(bearer(token)).expect(200);
    await ctx.http().post('/api/auth/logout').set(bearer(token)).expect(204);
    await ctx.http().get('/api/auth/me').set(bearer(token)).expect(401);
  });

  it('enforces authentication and roles', async () => {
    await ctx.http().get('/api/cart').expect(401);
    await ctx.http().get('/api/cart').set(bearer('not-a-jwt')).expect(401);

    const buyer = await register(ctx, 'BUYER');
    await ctx
      .http()
      .post('/api/products')
      .set(bearer(buyer.token))
      .field('name', 'x')
      .field('price', '1')
      .field('stock', '1')
      .expect(403);
    await ctx.http().get('/api/admin/products').set(bearer(buyer.token)).expect(403);
  });

  it('reports health', async () => {
    const res = await ctx.http().get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up', redis: 'up' });
  });
});
