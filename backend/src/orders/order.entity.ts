import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { OrderEvent, OrderStatus } from './order-state-machine';

@Entity({ name: 'orders' })
@Unique('uq_orders_user_idempotency_key', ['userId', 'idempotencyKey'])
@Index('idx_orders_status_expires', ['status', 'expiresAt'])
@Index('idx_orders_user_created', ['userId', 'createdAt'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    enumName: 'order_status',
    default: OrderStatus.PENDING_PAYMENT,
  })
  status: OrderStatus;

  @Column({ name: 'total_cents', type: 'int' })
  totalCents: number;

  /** Client-supplied key; the unique (user_id, idempotency_key) index is the last line of defence. */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  /** SHA-256 of the normalised request body, to reject a reused key with a different payload. */
  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'shipped_at', type: 'timestamptz', nullable: true })
  shippedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 200, nullable: true })
  cancelReason: string | null;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'order_items' })
@Check('chk_order_items_quantity', '"quantity" > 0')
@Index('idx_order_items_order', ['orderId'])
@Index('idx_order_items_seller', ['sellerId'])
export class OrderItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Order;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @Column({ name: 'seller_id', type: 'int' })
  sellerId: number;

  /** Snapshot at purchase time — later edits to the product do not rewrite history. */
  @Column({ name: 'product_name', type: 'varchar', length: 200 })
  productName: string;

  @Column({ name: 'product_image', type: 'text', nullable: true })
  productImage: string | null;

  @Column({ name: 'unit_price_cents', type: 'int' })
  unitPriceCents: number;

  @Column({ type: 'int' })
  quantity: number;
}

/** Append-only audit log: one row per status change. */
@Entity({ name: 'order_status_logs' })
@Index('idx_order_status_logs_order', ['orderId'])
export class OrderStatusLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'from_status', type: 'enum', enum: OrderStatus, enumName: 'order_status', nullable: true })
  fromStatus: OrderStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: OrderStatus, enumName: 'order_status' })
  toStatus: OrderStatus;

  @Column({ type: 'varchar', length: 20 })
  event: OrderEvent | 'CREATE';

  /** Null when the system acted (timeout). */
  @Column({ name: 'actor_id', type: 'int', nullable: true })
  actorId: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
