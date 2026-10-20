export type Role = 'BUYER' | 'SELLER' | 'ADMIN';

export interface User {
  id: number;
  username: string;
  phone: string | null;
  role: Role;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export type ProductStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';

export interface Product {
  id: number;
  sellerId: number;
  seller?: { id: number; username: string };
  name: string;
  description: string;
  priceCents: number;
  stock: number;
  category: string;
  images: string[];
  status: ProductStatus;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CartLine {
  productId: number;
  quantity: number;
  available: boolean;
  subtotalCents: number;
  product: Pick<Product, 'id' | 'name' | 'priceCents' | 'stock' | 'images' | 'status' | 'sellerId'>;
}

export interface Cart {
  items: CartLine[];
  totalCents: number;
}

export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';
export type OrderAction = 'PAY' | 'CANCEL' | 'SHIP' | 'CONFIRM';

export interface OrderItem {
  id: number;
  productId: number;
  sellerId: number;
  productName: string;
  productImage: string | null;
  unitPriceCents: number;
  quantity: number;
}

export interface Order {
  id: string;
  userId: number;
  status: OrderStatus;
  totalCents: number;
  expiresAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  items: OrderItem[];
  /** What the current viewer may do next, computed by the server's state machine. */
  actions: OrderAction[];
}
