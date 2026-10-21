# Prime Deals

[![CI](https://github.com/tyh-star/prime-deals/actions/workflows/ci.yml/badge.svg)](https://github.com/tyh-star/prime-deals/actions/workflows/ci.yml)

A multi-seller e-commerce platform. Buyers browse, add to cart, place orders and pay; sellers list products; admins review listings before they go live.

This is a rewrite of [dream-fire](https://github.com/tyh-star/dream-fire) (Spring Boot + MyBatis + Vue). It keeps the original feature set and adds the transactional core the old version lacked: **orders, oversell protection, idempotent checkout, an explicit order state machine, and automatic cancellation of unpaid orders**.

| Layer | Stack |
| --- | --- |
| Backend | NestJS 11, TypeORM 0.3, PostgreSQL 16, Redis 7, BullMQ |
| Frontend | React 18, TypeScript, Vite, TanStack Query, React Router |
| Testing | Jest + Supertest (end-to-end against real Postgres and Redis), Vitest + Testing Library |
| Delivery | Docker Compose, GitHub Actions |

Design decisions and trade-offs are explained in **[docs/DESIGN.md](docs/DESIGN.md)**.

## Highlights

- **No overselling.** Stock is deducted with a conditional `UPDATE ... WHERE stock >= :qty` inside the order transaction, rows are locked in a fixed order to avoid deadlocks, and a `CHECK (stock >= 0)` constraint backs it up. Tested: 30 concurrent buyers, 5 units in stock, exactly 5 orders succeed.
- **Idempotent checkout.** Every order request carries an `Idempotency-Key`. Redis turns away concurrent duplicates cheaply; a unique `(user_id, idempotency_key)` index guarantees correctness even if Redis loses the key. Tested: the same key fired 10 times at once creates one order and deducts stock once.
- **Order state machine.** Transitions are defined in a single table and applied with compare-and-set updates, so racing actions (pay vs. cancel, pay vs. timeout) can never both succeed.
- **Automatic timeout.** Unpaid orders are cancelled and their stock released by a BullMQ delayed job, with a periodic database sweep as a safety net for lost jobs. Stock is released exactly once.

## Quick start (Docker)

```bash
docker compose up --build
```

- Shop: http://localhost:8080
- API docs (Swagger): http://localhost:8080/api/docs
- Demo accounts (created when `SEED_DEMO=true`, the default in Compose):

  | Role | Username | Password |
  | --- | --- | --- |
  | Admin | `admin` | `admin12345` |
  | Seller | `demo-seller` | `demo-seller-pass` |
  | Buyer | `demo-buyer` | `demo-buyer-pass` |

  "Flash-Sale Desk Lamp" has only 3 units in stock, handy for trying the oversell protection by hand.

For anything other than local use, override the defaults:

```bash
JWT_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD='...' docker compose up --build
```

To see the payment timeout quickly, start with `ORDER_PAYMENT_TTL_SECONDS=60`, place an order and don't pay.

A smoke test exercises the whole flow (register → idempotent order → replay → pay → double pay rejected):

```bash
./scripts/smoke-test.sh http://localhost:8080
```

## Local development

Requires Node 22, PostgreSQL 16 and Redis 7 (or run just the dependencies with `docker compose up postgres redis` and expose their ports).

```bash
# Backend
cd backend
cp .env.example .env          # adjust DATABASE_URL / REDIS_URL if needed
npm install
npm run start:dev             # http://localhost:3000, runs migrations on start

# Frontend (in another terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173, proxies /api and /uploads to :3000
```

## Tests

```bash
cd backend
npm test                      # unit: state machine, idempotency fingerprint, price parsing, image checks
npm run test:e2e              # end-to-end: needs PostgreSQL and Redis (see below)

cd frontend
npm test                      # component and page tests (fetch is mocked)
```

The end-to-end suite connects to `postgres://postgres:postgres@localhost:5432/prime_deals_test` and `redis://localhost:6379/15` by default; override with `TEST_DATABASE_URL` / `TEST_REDIS_URL`. It wipes that database and Redis db, so **never point it at an instance with real data**.

Key scenarios covered end to end:

- 5 units, 30 concurrent buyers → exactly 5 orders, stock 0, 5 units sold
- Multi-item orders competing for the same products in opposite orders → no deadlock, no oversell
- One `Idempotency-Key` sent 10 times concurrently → one order, stock deducted once
- Idempotency record deleted from Redis, then a retry → the database constraint still returns the original order
- Same key reused with a different body → 422
- Concurrent pay and cancel → exactly one wins; stock matches the final status
- Unpaid order expires → the delayed job cancels it and restores stock; if the job is lost, the sweeper does it, once

## API overview

All routes are prefixed with `/api` and authenticated with `Authorization: Bearer <token>`. See Swagger for full schemas.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | anyone | Sign up (buyer or seller), sign in, sign out (revokes the token) |
| GET | `/products`, `/products/:id`, `/products/categories` | public | Search, filter, sort, paginate; only approved products are listed |
| POST / PATCH / DELETE | `/products`, `/products/:id` | seller | Create (multipart, up to 5 images), edit (goes back to review), archive |
| POST | `/products/:id/stock` | seller | Relative stock adjustment `{ delta }` |
| GET / POST / PATCH / DELETE | `/cart`, `/cart/items[/:productId]` | signed in | Cart |
| POST | `/orders` | signed in | Place an order; the `Idempotency-Key` header is **required** |
| GET | `/orders`, `/orders/:id`, `/orders/sales` | signed in / seller | My orders, details (including the `actions` I can take now), seller's sales |
| POST | `/orders/:id/pay`, `cancel`, `ship`, `confirm` | per state machine | Pay (simulated), cancel, ship, confirm delivery |
| GET / POST | `/admin/products`, `/admin/products/:id/approve`, `reject` | admin | Review queue |
| GET | `/admin/orders`, `/admin/users` | admin | All orders, users |

## Project structure

```
backend/
  src/
    auth/          JWT, global auth guard, login throttling, token revocation
    products/      products, image storage (magic-byte validation), review
    cart/          cart
    orders/        order service, state machine, idempotency, timeout queue and sweeper
    admin/         review and admin endpoints, admin/demo bootstrap on start
    database/      TypeORM data source and migrations
  test/            end-to-end tests (real Postgres + Redis)
frontend/
  src/
    api/           typed API client
    pages/         catalogue, product, cart, orders, seller dashboard, review
    components/    price tag, order progress, countdown and other UI pieces
docs/DESIGN.md     design notes
scripts/           smoke test
```

## Configuration

Backend environment variables (full list in `backend/.env.example`):

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/prime_deals` | |
| `REDIS_URL` | `redis://localhost:6379/0` | |
| `JWT_SECRET` | — | Required, at least 16 characters; the example value is refused in production |
| `JWT_EXPIRES_IN_SECONDS` | `7200` | |
| `ORDER_PAYMENT_TTL_SECONDS` | `900` | How long an unpaid order holds its stock |
| `ORDER_SWEEP_INTERVAL_MS` | `60000` | Safety-net sweep interval |
| `UPLOAD_DIR` | `./uploads` | Product image directory |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | — | Ensures this admin account exists on start |
| `SEED_DEMO` | `false` | Seeds demo products when the catalogue is empty |

## Known limitations

- Payment is simulated: `POST /orders/:id/pay` marks the order paid directly. A real integration would move this behind a verified payment-gateway webhook.
- Paid orders cannot be refunded yet, and orders spanning several sellers are shipped by an admin rather than split per seller.
- Images are stored on a local volume; multi-instance deployments should use object storage.

See the last section of [docs/DESIGN.md](docs/DESIGN.md) for how each would be addressed.
