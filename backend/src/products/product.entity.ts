import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum ProductStatus {
  /** Submitted (or edited) by a seller, waiting for admin review. Not publicly visible. */
  PENDING = 'PENDING',
  /** Visible in the catalogue and purchasable. */
  APPROVED = 'APPROVED',
  /** Rejected by an admin; the seller can edit and resubmit. */
  REJECTED = 'REJECTED',
  /** Taken off sale by its seller or an admin. Kept for order history. */
  ARCHIVED = 'ARCHIVED',
}

@Entity({ name: 'products' })
@Check('chk_products_stock_nonnegative', '"stock" >= 0')
@Check('chk_products_price_positive', '"price_cents" > 0')
@Index('idx_products_status_created', ['status', 'createdAt'])
@Index('idx_products_seller', ['sellerId'])
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'seller_id', type: 'int' })
  sellerId: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'seller_id' })
  seller?: User;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  /** Money is stored as integer cents to avoid floating-point rounding. */
  @Column({ name: 'price_cents', type: 'int' })
  priceCents: number;

  /** Authoritative stock. Only ever changed with conditional, relative UPDATEs. */
  @Column({ type: 'int', default: 0 })
  stock: number;

  @Column({ type: 'varchar', length: 100, default: 'General' })
  category: string;

  /** Public URLs of uploaded images; the first is the cover. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  images: string[];

  @Column({
    type: 'enum',
    enum: ProductStatus,
    enumName: 'product_status',
    default: ProductStatus.PENDING,
  })
  status: ProductStatus;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote: string | null;

  @Column({ name: 'reviewed_by', type: 'int', nullable: true })
  reviewedBy: number | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
