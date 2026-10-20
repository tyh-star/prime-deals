import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product, ProductStatus } from '../products/product.entity';
import { CartItem } from './cart-item.entity';

export const MAX_CART_QUANTITY = 99;

export interface CartLine {
  productId: number;
  quantity: number;
  product: Pick<Product, 'id' | 'name' | 'priceCents' | 'stock' | 'images' | 'status' | 'sellerId'>;
  /** False when the product is no longer on sale or has too little stock right now. */
  available: boolean;
  subtotalCents: number;
}

export interface CartView {
  items: CartLine[];
  totalCents: number;
}

/**
 * The cart is a wish list, not a reservation: stock is only taken when an order
 * is placed, so an abandoned cart never locks inventory.
 */
@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartItem) private readonly items: Repository<CartItem>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  async view(userId: number): Promise<CartView> {
    const rows = await this.items.find({
      where: { userId },
      relations: { product: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const items = rows
      .filter((row) => row.product)
      .map((row): CartLine => {
        const p = row.product as Product;
        const available = p.status === ProductStatus.APPROVED && p.stock >= row.quantity;
        return {
          productId: row.productId,
          quantity: row.quantity,
          product: {
            id: p.id,
            name: p.name,
            priceCents: p.priceCents,
            stock: p.stock,
            images: p.images,
            status: p.status,
            sellerId: p.sellerId,
          },
          available,
          subtotalCents: p.priceCents * row.quantity,
        };
      });
    const totalCents = items
      .filter((i) => i.available)
      .reduce((sum, i) => sum + i.subtotalCents, 0);
    return { items, totalCents };
  }

  /** Adds to (or increments) a line with a single atomic upsert. */
  async add(userId: number, productId: number, quantity: number): Promise<CartView> {
    await this.assertPurchasable(productId);
    await this.items.query(
      `INSERT INTO cart_items (user_id, product_id, quantity)
       VALUES ($1, $2, LEAST($3::int, ${MAX_CART_QUANTITY}))
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, ${MAX_CART_QUANTITY}),
                     updated_at = now()`,
      [userId, productId, quantity],
    );
    return this.view(userId);
  }

  async setQuantity(userId: number, productId: number, quantity: number): Promise<CartView> {
    const result = await this.items.update({ userId, productId }, { quantity });
    if (!result.affected) throw new NotFoundException('Item is not in your cart');
    return this.view(userId);
  }

  async remove(userId: number, productId: number): Promise<CartView> {
    await this.items.delete({ userId, productId });
    return this.view(userId);
  }

  async clear(userId: number): Promise<void> {
    await this.items.delete({ userId });
  }

  private async assertPurchasable(productId: number): Promise<void> {
    const ok = await this.products.exists({
      where: { id: productId, status: ProductStatus.APPROVED },
    });
    if (!ok) throw new NotFoundException('Product not found or not on sale');
  }
}
