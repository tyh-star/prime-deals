# Prime Deals

[![CI](https://github.com/tyh-star/prime-deals/actions/workflows/ci.yml/badge.svg)](https://github.com/tyh-star/prime-deals/actions/workflows/ci.yml)

一个多卖家电商平台：买家浏览、加购、下单、付款；卖家上传商品；管理员审核上架。
这是 [dream-fire](https://github.com/tyh-star/dream-fire)（Spring Boot + MyBatis + Vue）的重写版，重点补上了旧版缺失的交易链路：**订单、库存防超卖、下单幂等、订单状态机、超时自动取消**。

| 层 | 技术 |
| --- | --- |
| 后端 | NestJS 11 · TypeORM 0.3 · PostgreSQL 16 · Redis 7 · BullMQ |
| 前端 | React 18 · TypeScript · Vite · TanStack Query · React Router |
| 测试 | Jest + Supertest（真实 Postgres/Redis 的 e2e）· Vitest + Testing Library |
| 交付 | Docker Compose · GitHub Actions |

设计细节和取舍见 **[docs/DESIGN.md](docs/DESIGN.md)**。

## 快速开始（Docker）

```bash
docker compose up --build
```

- 商城：http://localhost:8080
- API 文档（Swagger）：http://localhost:8080/api/docs
- 预置账号（`SEED_DEMO=true` 时创建）：

  | 角色 | 用户名 | 密码 |
  | --- | --- | --- |
  | 管理员 | `admin` | `admin12345` |
  | 卖家 | `demo-seller` | `demo-seller-pass` |
  | 买家 | `demo-buyer` | `demo-buyer-pass` |

  "Flash-Sale Desk Lamp" 只有 3 件库存，可以用来手动体验防超卖。

任何非本机环境都请覆盖默认密钥：

```bash
JWT_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD='...' docker compose up --build
```

跑完后可以用冒烟脚本验证整条链路（注册 → 幂等下单 → 重放 → 付款 → 重复付款被拒）：

```bash
./scripts/smoke-test.sh http://localhost:8080
```

## 本地开发

需要 Node 22、PostgreSQL 16、Redis 7（也可以只用 compose 起依赖：`docker compose up postgres redis`，并把端口映射出来）。

```bash
# 后端
cd backend
cp .env.example .env          # 按需修改 DATABASE_URL / REDIS_URL
npm install
npm run start:dev             # http://localhost:3000，启动时自动执行迁移

# 前端（另一个终端）
cd frontend
npm install
npm run dev                   # http://localhost:5173，/api 与 /uploads 代理到 :3000
```

## 测试

```bash
cd backend
npm test                      # 单元测试：状态机、幂等指纹、金额解析、图片校验
npm run test:e2e              # 端到端：需要 Postgres 与 Redis（见下）

cd frontend
npm test                      # 组件与页面测试（fetch 被 mock）
```

e2e 默认连接 `postgres://postgres:postgres@localhost:5432/prime_deals_test` 和 `redis://localhost:6379/15`，
可用 `TEST_DATABASE_URL` / `TEST_REDIS_URL` 覆盖。测试会清空这个库和这个 Redis db，**不要指向有数据的实例**。

e2e 覆盖的关键场景：

- 5 件库存、30 个买家并发下单 → 恰好 5 单成功，库存为 0，卖出数量为 5
- 多商品订单以不同顺序并发争抢同一批商品 → 无死锁、无超卖
- 同一个 `Idempotency-Key` 并发 10 次 → 只生成 1 个订单、只扣 1 次库存
- Redis 中的幂等记录丢失后重试 → 由数据库唯一约束兜底，仍返回原订单
- 同一 key 换了请求体 → 422
- 付款与取消并发 → 恰好一个成功，库存与最终状态一致
- 未付款订单到期 → 延时任务取消并回补库存；任务丢失时由清扫器兜底，且只回补一次

## API 概览

所有接口前缀 `/api`，鉴权使用 `Authorization: Bearer <token>`。完整定义见 Swagger。

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| POST | `/auth/register` · `/auth/login` · `/auth/logout` | — | 注册（买家/卖家）、登录、注销（吊销 token） |
| GET | `/products` · `/products/:id` · `/products/categories` | 公开 | 搜索、筛选、排序、分页；只展示已上架商品 |
| POST/PATCH/DELETE | `/products` · `/products/:id` | 卖家 | 上传（multipart，≤5 张图）、编辑（重新进入审核）、下架 |
| POST | `/products/:id/stock` | 卖家 | 相对调整库存 `{ delta }` |
| GET/POST/PATCH/DELETE | `/cart` · `/cart/items[/:productId]` | 登录 | 购物车 |
| POST | `/orders` | 登录 | 下单，**必须**带 `Idempotency-Key` 头 |
| GET | `/orders` · `/orders/:id` · `/orders/sales` | 登录 / 卖家 | 我的订单、详情（含当前可执行的 `actions`）、卖家销售单 |
| POST | `/orders/:id/pay` · `cancel` · `ship` · `confirm` | 按状态机授权 | 付款（模拟）、取消、发货、确认收货 |
| GET/POST | `/admin/products` · `/admin/products/:id/approve` · `reject` | 管理员 | 审核队列 |
| GET | `/admin/orders` · `/admin/users` | 管理员 | 全部订单、用户 |

## 目录结构

```
backend/
  src/
    auth/          JWT、全局鉴权守卫、登录限流、token 吊销
    products/      商品、图片存储（魔数校验）、审核
    cart/          购物车
    orders/        订单服务、状态机、幂等、超时队列与清扫器
    admin/         审核与管理接口、启动时的管理员/演示数据
    database/      TypeORM 数据源与迁移
  test/            e2e（真实 Postgres + Redis）
frontend/
  src/
    api/           类型化的 API 客户端
    pages/         目录、商品、购物车、订单、卖家后台、审核
    components/    价签、订单进度、倒计时等
docs/DESIGN.md     设计说明
scripts/           冒烟测试
```

## 配置

后端环境变量（完整列表见 `backend/.env.example`）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/prime_deals` | |
| `REDIS_URL` | `redis://localhost:6379/0` | |
| `JWT_SECRET` | — | 必填，≥16 字符；生产环境拒绝示例值 |
| `JWT_EXPIRES_IN_SECONDS` | `7200` | |
| `ORDER_PAYMENT_TTL_SECONDS` | `900` | 未付款订单的保留时间 |
| `ORDER_SWEEP_INTERVAL_MS` | `60000` | 兜底清扫周期 |
| `UPLOAD_DIR` | `./uploads` | 商品图片目录 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | — | 启动时确保存在该管理员 |
| `SEED_DEMO` | `false` | 目录为空时写入演示商品 |
