import { request, requestRaw } from './client';
import type {
  AuthResponse,
  Cart,
  Order,
  OrderAction,
  OrderStatus,
  Paginated,
  Product,
  ProductStatus,
  Role,
  User,
} from './types';

export interface ProductQuery {
  q?: string;
  category?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  page?: number;
  pageSize?: number;
}

export const api = {
  register: (body: { username: string; password: string; phone?: string; role: Exclude<Role, 'ADMIN'> }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body }),
  login: (body: { username: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<User>('/auth/me'),

  products: (query: ProductQuery) =>
    request<Paginated<Product>>('/products', { query: { ...query } }),
  categories: () => request<string[]>('/products/categories'),
  product: (id: number) => request<Product>(`/products/${id}`),
  myProducts: (page = 1) => request<Paginated<Product>>('/products/mine', { query: { page, pageSize: 50 } }),
  createProduct: (form: FormData) => request<Product>('/products', { method: 'POST', body: form }),
  updateProduct: (id: number, form: FormData) =>
    request<Product>(`/products/${id}`, { method: 'PATCH', body: form }),
  adjustStock: (id: number, delta: number) =>
    request<Product>(`/products/${id}/stock`, { method: 'POST', body: { delta } }),
  archiveProduct: (id: number) => request<void>(`/products/${id}`, { method: 'DELETE' }),

  cart: () => request<Cart>('/cart'),
  addToCart: (productId: number, quantity: number) =>
    request<Cart>('/cart/items', { method: 'POST', body: { productId, quantity } }),
  setCartQuantity: (productId: number, quantity: number) =>
    request<Cart>(`/cart/items/${productId}`, { method: 'PATCH', body: { quantity } }),
  removeFromCart: (productId: number) => request<Cart>(`/cart/items/${productId}`, { method: 'DELETE' }),

  /** The key must stay the same across retries of one checkout attempt. */
  placeOrder: async (
    items: Array<{ productId: number; quantity: number }>,
    idempotencyKey: string,
  ): Promise<{ order: Order; replayed: boolean }> => {
    const res = await requestRaw<Order>('/orders', {
      method: 'POST',
      body: { items, clearCartItems: true },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return { order: res.data, replayed: res.headers.get('Idempotent-Replayed') === 'true' };
  },
  orders: (status?: OrderStatus, page = 1) =>
    request<Paginated<Order>>('/orders', { query: { status, page, pageSize: 20 } }),
  sales: (status?: OrderStatus, page = 1) =>
    request<Paginated<Order>>('/orders/sales', { query: { status, page, pageSize: 20 } }),
  order: (id: string) => request<Order>(`/orders/${id}`),
  orderAction: (id: string, action: OrderAction, reason?: string) =>
    request<Order>(`/orders/${id}/${action.toLowerCase()}`, {
      method: 'POST',
      body: action === 'CANCEL' && reason ? { reason } : undefined,
    }),

  reviewQueue: (status: ProductStatus | undefined, page = 1) =>
    request<Paginated<Product>>('/admin/products', { query: { status, page, pageSize: 20 } }),
  approve: (id: number) => request<Product>(`/admin/products/${id}/approve`, { method: 'POST' }),
  reject: (id: number, reason: string) =>
    request<Product>(`/admin/products/${id}/reject`, { method: 'POST', body: { reason } }),
  allOrders: (status?: OrderStatus, page = 1) =>
    request<Paginated<Order>>('/admin/orders', { query: { status, page, pageSize: 20 } }),
};
