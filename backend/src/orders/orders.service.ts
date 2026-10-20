import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CartItem } from '../cart/cart-item.entity';
import { AuthUser } from '../common/auth.decorators';
import { Paginated } from '../common/pagination.dto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Product, ProductStatus } from '../products/product.entity';
import { Role } from '../users/user.entity';
import { isUniqueViolation } from '../users/users.service';
import { fingerprint, IdempotencyService, normalizeLines, OrderLine } from './idempotency.service';
import { CreateOrderDto } from './order.dto';
import { Order, OrderItem, OrderStatusLog } from './order.entity';
import {
  allowedEvents,
  IllegalTransitionError,
  nextStatus,
  OrderEvent,
  OrderStatus,
  releasesStock,
} from './order-state-machine';
import { OrderTimeoutQueue } from './order-timeout.queue';

/** Keeps totals inside a 32-bit integer column. */
const MAX_ORDER_TOTAL_CENTS = 2_000_000_000;

export type OrderView = Order & { actions: OrderEvent[] };
export type ExpireResult = 'cancelled' | 'not_pending' | 'not_due';

interface ReturnedProductRow {
  id: number;
  name: string;
  price_cents: number;
  seller_id: number;
  images: string[];
}

/** TypeORM's postgres driver nests RETURNING rows differently across versions. */
function returnedRows<T>(raw: unknown): T[] {
  if (Array.isArray(raw) && Array.isArray(raw[0])) return raw[0] as T[];
  return (Array.isArray(raw) ? raw : []) as T[];
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly idempotency: IdempotencyService,
    private readonly timeoutQueue: OrderTimeoutQueue,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ---------------------------------------------------------------- placing

  /**
   * Places an order exactly once per (user, Idempotency-Key).
   *  1. Redis claim turns away concurrent duplicates and replays finished ones.
   *  2. One transaction inserts the order (unique key = DB-level idempotency),
   *     deducts stock with conditional UPDATEs, and snapshots the line items.
   *  3. After commit, a delayed job is scheduled to cancel it if unpaid.
   */
  async place(
    user: AuthUser,
    idempotencyKey: string,
    dto: CreateOrderDto,
  ): Promise<{ order: Order; replayed: boolean }> {
    const lines = normalizeLines(dto.items);
    const requestHash = fingerprint(lines);

    const claim = await this.idempotency.claim(user.id, idempotencyKey, requestHash);
    switch (claim.state) {
      case 'mismatch':
        throw this.keyReused();
      case 'in_progress':
        throw new ConflictException({
          code: 'IDEMPOTENCY_IN_PROGRESS',
          message: 'An identical request is still being processed; retry shortly',
        });
      case 'done':
        return { order: await this.load(claim.orderId), replayed: true };
    }

    let order: Order;
    try {
      order = await this.dataSource.transaction((m) =>
        this.createInTransaction(m, user.id, idempotencyKey, requestHash, lines, !!dto.clearCartItems),
      );
    } catch (err) {
      if (isUniqueViolation(err, 'uq_orders_user_idempotency_key')) {
        // Redis missed it (restart, eviction, expiry) but the database did not.
        const existing = await this.orders.findOne({
          where: { userId: user.id, idempotencyKey },
          relations: { items: true },
        });
        if (existing && existing.requestHash === requestHash) {
          await this.idempotency.complete(user.id, idempotencyKey, requestHash, existing.id);
          return { order: existing, replayed: true };
        }
        await this.idempotency.release(user.id, idempotencyKey);
        throw this.keyReused();
      }
      await this.idempotency.release(user.id, idempotencyKey);
      throw err;
    }

    await this.idempotency.complete(user.id, idempotencyKey, requestHash, order.id);
    await this.timeoutQueue.schedule(order.id, order.expiresAt);
    return { order, replayed: false };
  }

  private async createInTransaction(
    m: EntityManager,
    userId: number,
    idempotencyKey: string,
    requestHash: string,
    lines: OrderLine[],
    clearCartItems: boolean,
  ): Promise<Order> {
    // Insert the order row first: a duplicate key fails here, before touching stock.
    const ttl = this.cfg.orderPaymentTtlSeconds; // validated integer
    const inserted = await m
      .createQueryBuilder()
      .insert()
      .into(Order)
      .values({
        userId,
        status: OrderStatus.PENDING_PAYMENT,
        totalCents: 0,
        idempotencyKey,
        requestHash,
        // Database clock, so it is consistent with the `now()` checks in transitions.
        expiresAt: () => `now() + interval '${ttl} seconds'`,
      })
      .returning(['id'])
      .execute();
    const orderId = (inserted.identifiers[0]?.id ??
      returnedRows<{ id: string }>(inserted.raw)[0]?.id) as string;

    const items: QueryDeepPartialEntity<OrderItem>[] = [];
    let total = 0;
    // `lines` is sorted by productId → row locks are always taken in the same order.
    for (const line of lines) {
      const result = await m
        .createQueryBuilder()
        .update(Product)
        .set({ stock: () => 'stock - :qty' })
        .where('id = :id AND status = :approved AND stock >= :qty', {
          id: line.productId,
          qty: line.quantity,
          approved: ProductStatus.APPROVED,
        })
        .returning('*')
        .execute();

      const [row] = returnedRows<ReturnedProductRow>(result.raw);
      if (!result.affected || !row) {
        return this.explainStockFailure(m, line);
      }
      if (row.seller_id === userId) {
        throw new BadRequestException({
          code: 'OWN_PRODUCT',
          message: `You cannot buy your own product "${row.name}"`,
        });
      }
      total += row.price_cents * line.quantity;
      items.push({
        orderId,
        productId: row.id,
        sellerId: row.seller_id,
        productName: row.name,
        productImage: row.images?.[0] ?? null,
        unitPriceCents: row.price_cents,
        quantity: line.quantity,
      });
    }

    if (total > MAX_ORDER_TOTAL_CENTS) {
      throw new UnprocessableEntityException({
        code: 'ORDER_TOO_LARGE',
        message: 'Order total is too large; split it into several orders',
      });
    }

    await m.insert(OrderItem, items);
    await m.update(Order, { id: orderId }, { totalCents: total });
    await m.insert(OrderStatusLog, {
      orderId,
      fromStatus: null,
      toStatus: OrderStatus.PENDING_PAYMENT,
      event: 'CREATE',
      actorId: userId,
    });
    if (clearCartItems) {
      await m.delete(CartItem, { userId, productId: In(lines.map((l) => l.productId)) });
    }
    return m.findOneOrFail(Order, { where: { id: orderId }, relations: { items: true } });
  }

  /** The conditional UPDATE matched nothing — find out why, for a useful error. Always throws. */
  private async explainStockFailure(m: EntityManager, line: OrderLine): Promise<never> {
    const product = await m.findOne(Product, { where: { id: line.productId } });
    if (!product || product.status !== ProductStatus.APPROVED) {
      throw new ConflictException({
        code: 'PRODUCT_UNAVAILABLE',
        message: `Product ${line.productId} is not on sale`,
        productId: line.productId,
      });
    }
    throw new ConflictException({
      code: 'INSUFFICIENT_STOCK',
      message: `Only ${product.stock} left of "${product.name}"`,
      productId: product.id,
      available: product.stock,
    });
  }

  private keyReused() {
    return new UnprocessableEntityException({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This Idempotency-Key was already used for a different request',
    });
  }

  // ----------------------------------------------------------- transitions

  /**
   * Applies a state-machine event. The status write is a compare-and-set on the
   * status we read, so if two transitions race (pay vs. timeout, double cancel)
   * exactly one wins and the other gets 409.
   */
  async transition(
    orderId: string,
    event: OrderEvent,
    actor: AuthUser | null,
    reason?: string,
  ): Promise<Order> {
    const order = await this.dataSource.transaction(async (m) => {
      const current = await m.findOne(Order, { where: { id: orderId }, relations: { items: true } });
      if (!current || (actor && !this.canView(current, actor))) {
        throw new NotFoundException('Order not found');
      }
      if (!this.isAllowed(current, event, actor)) {
        throw new ForbiddenException(`You are not allowed to ${event.toLowerCase()} this order`);
      }

      let to: OrderStatus;
      try {
        to = nextStatus(current.status, event);
      } catch (err) {
        if (err instanceof IllegalTransitionError) {
          throw new ConflictException({
            code: 'ILLEGAL_TRANSITION',
            message: err.message,
            status: current.status,
          });
        }
        throw err;
      }

      const qb = m
        .createQueryBuilder()
        .update(Order)
        .set(this.patchFor(event, to, reason))
        .where('id = :id AND status = :from', { id: orderId, from: current.status });
      if (event === OrderEvent.PAY) qb.andWhere('expires_at > now()');
      if (event === OrderEvent.EXPIRE) qb.andWhere('expires_at <= now()');
      const result = await qb.execute();

      if (result.affected !== 1) {
        const latest = await m.findOne(Order, { where: { id: orderId } });
        if (latest && latest.status === current.status) {
          if (event === OrderEvent.PAY) {
            throw new ConflictException({
              code: 'ORDER_EXPIRED',
              message: 'The payment window for this order has closed',
            });
          }
          if (event === OrderEvent.EXPIRE) {
            throw new ConflictException({ code: 'NOT_YET_EXPIRED', message: 'Order is not due yet' });
          }
        }
        throw new ConflictException({
          code: 'CONCURRENT_UPDATE',
          message: 'The order changed while processing your request; reload and try again',
          status: latest?.status,
        });
      }

      if (releasesStock(event)) {
        const items = [...current.items].sort((a, b) => a.productId - b.productId);
        for (const item of items) {
          await m
            .createQueryBuilder()
            .update(Product)
            .set({ stock: () => 'stock + :qty' })
            .where('id = :id', { id: item.productId, qty: item.quantity })
            .execute();
        }
      }

      await m.insert(OrderStatusLog, {
        orderId,
        fromStatus: current.status,
        toStatus: to,
        event,
        actorId: actor?.id ?? null,
      });
      return m.findOneOrFail(Order, { where: { id: orderId }, relations: { items: true } });
    });

    if (event === OrderEvent.PAY || event === OrderEvent.CANCEL) {
      await this.timeoutQueue.cancel(orderId);
    }
    return order;
  }

  private patchFor(event: OrderEvent, to: OrderStatus, reason?: string): QueryDeepPartialEntity<Order> {
    const now = () => 'now()';
    switch (event) {
      case OrderEvent.PAY:
        return { status: to, paidAt: now };
      case OrderEvent.SHIP:
        return { status: to, shippedAt: now };
      case OrderEvent.CONFIRM:
        return { status: to, completedAt: now };
      case OrderEvent.CANCEL:
        return { status: to, cancelledAt: now, cancelReason: reason?.trim() || 'Cancelled by request' };
      case OrderEvent.EXPIRE:
        return { status: to, cancelledAt: now, cancelReason: 'Payment window expired' };
    }
  }

  /** Who may trigger which event. `actor === null` means the system (timeout). */
  private isAllowed(order: Order, event: OrderEvent, actor: AuthUser | null): boolean {
    if (event === OrderEvent.EXPIRE) return actor === null;
    if (!actor) return false;
    const isOwner = order.userId === actor.id;
    switch (event) {
      case OrderEvent.PAY:
      case OrderEvent.CONFIRM:
        return isOwner;
      case OrderEvent.CANCEL:
        return isOwner || actor.role === Role.ADMIN;
      case OrderEvent.SHIP:
        // A seller can ship an order only when every line is theirs; mixed orders go via admin.
        return (
          actor.role === Role.ADMIN ||
          (actor.role === Role.SELLER &&
            order.items.length > 0 &&
            order.items.every((i) => i.sellerId === actor.id))
        );
    }
  }

  private canView(order: Order, actor: AuthUser): boolean {
    return (
      actor.role === Role.ADMIN ||
      order.userId === actor.id ||
      order.items.some((i) => i.sellerId === actor.id)
    );
  }

  /** Adds the actions this viewer can take right now, so clients need no copy of the rules. */
  present(order: Order, actor: AuthUser): OrderView {
    const actions = allowedEvents(order.status).filter(
      (event) => event !== OrderEvent.EXPIRE && this.isAllowed(order, event, actor),
    );
    return Object.assign(order, { actions });
  }

  // ---------------------------------------------------------------- timeout

  /** Handler for the delayed job. Safe to run any number of times. */
  async expire(orderId: string): Promise<ExpireResult> {
    try {
      await this.transition(orderId, OrderEvent.EXPIRE, null);
      return 'cancelled';
    } catch (err) {
      if (err instanceof NotFoundException) return 'not_pending';
      if (err instanceof ConflictException) {
        const code = (err.getResponse() as { code?: string }).code;
        return code === 'NOT_YET_EXPIRED' ? 'not_due' : 'not_pending';
      }
      throw err;
    }
  }

  /** Safety net for orders whose delayed job was lost (e.g. Redis flushed). */
  async expireOverdue(limit = 100): Promise<number> {
    const overdue = await this.orders
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where('o.status = :status AND o.expires_at <= now()', {
        status: OrderStatus.PENDING_PAYMENT,
      })
      .orderBy('o.expires_at', 'ASC')
      .limit(limit)
      .getRawMany<{ id: string }>();
    let cancelled = 0;
    for (const { id } of overdue) {
      if ((await this.expire(id)) === 'cancelled') cancelled++;
    }
    return cancelled;
  }

  // ---------------------------------------------------------------- queries

  async getForActor(id: string, actor: AuthUser): Promise<Order> {
    const order = await this.orders.findOne({ where: { id }, relations: { items: true } });
    if (!order || !this.canView(order, actor)) throw new NotFoundException('Order not found');
    return order;
  }

  listForBuyer(userId: number, status: OrderStatus | undefined, page: number, pageSize: number) {
    return this.paginate({ userId }, status, page, pageSize);
  }

  listAll(status: OrderStatus | undefined, page: number, pageSize: number) {
    return this.paginate({}, status, page, pageSize);
  }

  /** Orders containing at least one of this seller's products (showing only their lines). */
  async listForSeller(
    sellerId: number,
    status: OrderStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<Paginated<Order>> {
    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'i')
      .where(
        'EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.seller_id = :sellerId)',
        { sellerId },
      );
    if (status) qb.andWhere('o.status = :status', { status });
    const [orders, total] = await qb
      .orderBy('o.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    for (const order of orders) {
      order.items = order.items.filter((i) => i.sellerId === sellerId);
    }
    return { items: orders, total, page, pageSize };
  }

  private async paginate(
    where: { userId?: number },
    status: OrderStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<Paginated<Order>> {
    const [items, total] = await this.orders.findAndCount({
      where: { ...where, ...(status ? { status } : {}) },
      relations: { items: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  private load(id: string): Promise<Order> {
    return this.orders.findOneOrFail({ where: { id }, relations: { items: true } });
  }
}
