import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1729400000000 implements MigrationInterface {
  name = 'InitialSchema1729400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE "user_role" AS ENUM ('BUYER', 'SELLER', 'ADMIN')`);
    await q.query(
      `CREATE TYPE "product_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED')`,
    );
    await q.query(
      `CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED')`,
    );

    await q.query(`
      CREATE TABLE "users" (
        "id"            SERIAL PRIMARY KEY,
        "username"      varchar(50)  NOT NULL,
        "password_hash" varchar(100) NOT NULL,
        "phone"         varchar(30),
        "role"          "user_role"  NOT NULL DEFAULT 'BUYER',
        "created_at"    timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_username" UNIQUE ("username")
      )`);

    await q.query(`
      CREATE TABLE "products" (
        "id"          SERIAL PRIMARY KEY,
        "seller_id"   integer          NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "name"        varchar(200)     NOT NULL,
        "description" text             NOT NULL DEFAULT '',
        "price_cents" integer          NOT NULL,
        "stock"       integer          NOT NULL DEFAULT 0,
        "category"    varchar(100)     NOT NULL DEFAULT 'General',
        "images"      text[]           NOT NULL DEFAULT '{}',
        "status"      "product_status" NOT NULL DEFAULT 'PENDING',
        "review_note" text,
        "reviewed_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "reviewed_at" timestamptz,
        "created_at"  timestamptz      NOT NULL DEFAULT now(),
        "updated_at"  timestamptz      NOT NULL DEFAULT now(),
        CONSTRAINT "chk_products_stock_nonnegative" CHECK ("stock" >= 0),
        CONSTRAINT "chk_products_price_positive" CHECK ("price_cents" > 0)
      )`);
    await q.query(
      `CREATE INDEX "idx_products_status_created" ON "products" ("status", "created_at")`,
    );
    await q.query(`CREATE INDEX "idx_products_seller" ON "products" ("seller_id")`);

    await q.query(`
      CREATE TABLE "cart_items" (
        "id"         SERIAL PRIMARY KEY,
        "user_id"    integer     NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "product_id" integer     NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
        "quantity"   integer     NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_cart_items_user_product" UNIQUE ("user_id", "product_id"),
        CONSTRAINT "chk_cart_items_quantity" CHECK ("quantity" > 0)
      )`);

    await q.query(`
      CREATE TABLE "orders" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"         integer        NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "status"          "order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
        "total_cents"     integer        NOT NULL,
        "idempotency_key" varchar(128)   NOT NULL,
        "request_hash"    char(64)       NOT NULL,
        "expires_at"      timestamptz    NOT NULL,
        "paid_at"         timestamptz,
        "shipped_at"      timestamptz,
        "completed_at"    timestamptz,
        "cancelled_at"    timestamptz,
        "cancel_reason"   varchar(200),
        "created_at"      timestamptz    NOT NULL DEFAULT now(),
        "updated_at"      timestamptz    NOT NULL DEFAULT now(),
        CONSTRAINT "uq_orders_user_idempotency_key" UNIQUE ("user_id", "idempotency_key")
      )`);
    await q.query(`CREATE INDEX "idx_orders_status_expires" ON "orders" ("status", "expires_at")`);
    await q.query(`CREATE INDEX "idx_orders_user_created" ON "orders" ("user_id", "created_at")`);

    await q.query(`
      CREATE TABLE "order_items" (
        "id"               SERIAL PRIMARY KEY,
        "order_id"         uuid         NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "product_id"       integer      NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
        "seller_id"        integer      NOT NULL,
        "product_name"     varchar(200) NOT NULL,
        "product_image"    text,
        "unit_price_cents" integer      NOT NULL,
        "quantity"         integer      NOT NULL,
        CONSTRAINT "chk_order_items_quantity" CHECK ("quantity" > 0)
      )`);
    await q.query(`CREATE INDEX "idx_order_items_order" ON "order_items" ("order_id")`);
    await q.query(`CREATE INDEX "idx_order_items_seller" ON "order_items" ("seller_id")`);

    await q.query(`
      CREATE TABLE "order_status_logs" (
        "id"          SERIAL PRIMARY KEY,
        "order_id"    uuid           NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "from_status" "order_status",
        "to_status"   "order_status" NOT NULL,
        "event"       varchar(20)    NOT NULL,
        "actor_id"    integer,
        "created_at"  timestamptz    NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX "idx_order_status_logs_order" ON "order_status_logs" ("order_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "order_status_logs"`);
    await q.query(`DROP TABLE "order_items"`);
    await q.query(`DROP TABLE "orders"`);
    await q.query(`DROP TABLE "cart_items"`);
    await q.query(`DROP TABLE "products"`);
    await q.query(`DROP TABLE "users"`);
    await q.query(`DROP TYPE "order_status"`);
    await q.query(`DROP TYPE "product_status"`);
    await q.query(`DROP TYPE "user_role"`);
  }
}
