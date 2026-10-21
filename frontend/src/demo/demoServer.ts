/**
 * In-browser stand-in for the Prime Deals API, used only by the demo build
 * (`VITE_DEMO=true`). It answers the same routes with the same shapes and applies
 * the same rules as the real backend: conditional stock deduction, idempotent
 * order placement, the order state machine and payment timeouts. Data lives in
 * localStorage, so each visitor gets their own sandbox.
 *
 * The real implementation is in backend/src; this file mirrors its behaviour and
 * is not used by the production build.
 */
import type {
  Cart,
  CartLine,
  Order,
  OrderAction,
  OrderItem,
  OrderStatus,
  Paginated,
  Product,
  ProductStatus,
  Role,
  User,
} from '../api/types';

export const DEMO_PAYMENT_TTL_MS = 3 * 60_000;
const STORAGE_KEY = 'pd.demo.db.v1';
const MAX_DEMO_IMAGE_BYTES = 1_500_000;

type OrderEvent = OrderAction | 'EXPIRE';

/** Same transition table as backend/src/orders/order-state-machine.ts. */
const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>> = {
  PENDING_PAYMENT: { PAY: 'PAID', CANCEL: 'CANCELLED', EXPIRE: 'CANCELLED' },
  PAID: { SHIP: 'SHIPPED' },
  SHIPPED: { CONFIRM: 'COMPLETED' },
  COMPLETED: {},
  CANCELLED: {},
};

interface DemoUser extends User {
  password: string;
}

interface DemoOrder extends Omit<Order, 'actions'> {
  idempotencyKey: string;
  requestHash: string;
}

interface CartRow {
  userId: number;
  productId: number;
  quantity: number;
}

interface Db {
  seq: number;
  users: DemoUser[];
  products: Product[];
  cart: CartRow[];
  orders: DemoOrder[];
  sessions: Record<string, number>;
  failedLogins: Record<string, number>;
}

export interface DemoRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: unknown;
}

export interface DemoResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.message));
  }
}

const fail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  new HttpError(status, { statusCode: status, message, ...extra });

// ------------------------------------------------------------------ seed data

function seed(now: number): Db {
  const iso = (offsetMs = 0) => new Date(now + offsetMs).toISOString();
  const day = 86_400_000;
  const user = (id: number, username: string, password: string, role: Role, ago: number): DemoUser => ({
    id,
    username,
    password,
    role,
    phone: null,
    createdAt: iso(-ago * day),
  });
  const users = [
    user(1, 'admin', 'admin12345', 'ADMIN', 30),
    user(2, 'demo-seller', 'demo-seller-pass', 'SELLER', 28),
    user(3, 'demo-buyer', 'demo-buyer-pass', 'BUYER', 20),
    user(4, 'north-supply', 'north-supply-pass', 'SELLER', 15),
  ];

  let id = 0;
  const product = (
    sellerId: number,
    name: string,
    description: string,
    priceCents: number,
    stock: number,
    category: string,
    status: ProductStatus = 'APPROVED',
    ago = 10,
  ): Product => ({
    id: ++id,
    sellerId,
    seller: { id: sellerId, username: users.find((u) => u.id === sellerId)!.username },
    name,
    description,
    priceCents,
    stock,
    category,
    images: [],
    status,
    reviewNote: null,
    createdAt: iso(-ago * day),
    updatedAt: iso(-ago * day),
  });

  const products = [
    product(2, 'Noise-Cancelling Headphones', 'Over-ear, 30 h battery, USB-C fast charge.', 12999, 25, 'Electronics', 'APPROVED', 9),
    product(2, 'Mechanical Keyboard', 'Hot-swappable switches, 75% layout, white backlight.', 8950, 40, 'Electronics', 'APPROVED', 8),
    product(4, '27" 4K Monitor', 'IPS panel, 99% sRGB, height-adjustable stand.', 32900, 8, 'Electronics', 'APPROVED', 7),
    product(2, 'Pour-Over Coffee Set', 'Glass dripper, gooseneck kettle and 100 filters.', 4599, 60, 'Home', 'APPROVED', 6),
    product(4, 'Cast-Iron Skillet 26 cm', 'Pre-seasoned, oven safe, lasts for decades.', 3499, 30, 'Home', 'APPROVED', 5),
    product(2, 'Merino Wool Hoodie', 'Lightweight, odour-resistant, machine washable.', 7900, 15, 'Apparel', 'APPROVED', 4),
    product(4, 'Trail Running Shoes', 'Grippy outsole, rock plate, 6 mm drop.', 11900, 12, 'Apparel', 'APPROVED', 3),
    product(2, 'Flash-Sale Desk Lamp', 'Only 3 in stock. Try ordering more than are left.', 1999, 3, 'Home', 'APPROVED', 2),
    product(4, 'Bamboo Cutting Board', 'Large, reversible, with a juice groove.', 2850, 20, 'Home', 'PENDING', 1),
    product(2, 'Wireless Charging Pad', '15 W, works through most phone cases.', 2499, 50, 'Electronics', 'PENDING', 0.5),
  ];

  const kb = products[1];
  const pastOrder: DemoOrder = {
    id: '7d1c2b9e-5a4f-4e3d-9c21-0f6b8a1d2e30',
    userId: 3,
    status: 'COMPLETED',
    totalCents: kb.priceCents,
    expiresAt: iso(-5 * day + DEMO_PAYMENT_TTL_MS),
    createdAt: iso(-5 * day),
    paidAt: iso(-5 * day + 60_000),
    shippedAt: iso(-4 * day),
    completedAt: iso(-2 * day),
    cancelledAt: null,
    cancelReason: null,
    idempotencyKey: 'seed-order-0001',
    requestHash: `${kb.id}x1`,
    items: [
      {
        id: 1,
        productId: kb.id,
        sellerId: kb.sellerId,
        productName: kb.name,
        productImage: null,
        unitPriceCents: kb.priceCents,
        quantity: 1,
      },
    ],
  };

  return { seq: 100, users, products, cart: [], orders: [pastOrder], sessions: {}, failedLogins: {} };
}

// ------------------------------------------------------------------ helpers

const PRICE = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

function parsePrice(input: string): number | null {
  const m = PRICE.exec(input.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

function normalizeLines(lines: Array<{ productId: number; quantity: number }>) {
  const merged = new Map<number, number>();
  for (const { productId, quantity } of lines) merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId - b.productId);
}

function paginate<T>(items: T[], url: URL, defaultSize = 12): Paginated<T> {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize')) || defaultSize));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

function sniffImage(bytes: Uint8Array): boolean {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b);
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  const isWebp = ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  return isJpeg || isPng || isWebp;
}

function read<T>(blob: Blob, how: 'readAsDataURL' | 'readAsArrayBuffer'): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    reader[how](blob);
  });
}

const toDataUrl = (file: File) => read<string>(file, 'readAsDataURL');

function publicUser(u: DemoUser): User {
  const { password: _password, ...rest } = u;
  return rest;
}

// ------------------------------------------------------------------ server

export interface DemoServerOptions {
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export class DemoServer {
  private db: Db;
  private readonly now: () => number;
  private readonly storage: DemoServerOptions['storage'];

  constructor(opts: DemoServerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.storage = opts.storage;
    this.db = this.load() ?? seed(this.now());
  }

  reset(): void {
    this.db = seed(this.now());
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  private load(): Db | null {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Db) : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* storage full or unavailable: keep working in memory */
    }
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private nextId(): number {
    return ++this.db.seq;
  }

  async handle(req: DemoRequest): Promise<DemoResponse> {
    try {
      this.expireOverdue();
      const res = await this.route(req);
      if (req.method !== 'GET') this.save();
      return res;
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: err.body };
      return { status: 500, body: { statusCode: 500, message: (err as Error).message } };
    }
  }

  // ---------------------------------------------------------------- routing

  private async route({ method, url, headers, body }: DemoRequest): Promise<DemoResponse> {
    const path = url.pathname.replace(/^.*?\/api/, '');
    const me = this.authenticate(headers);
    const json = (body ?? {}) as Record<string, unknown>;
    const ok = (data: unknown, status = 200, extra?: Record<string, string>): DemoResponse => ({
      status,
      body: data,
      headers: extra,
    });
    const need = (...roles: Role[]): DemoUser => {
      if (!me) throw fail(401, 'Login required');
      if (roles.length && !roles.includes(me.role)) throw fail(403, `Requires role: ${roles.join(' or ')}`);
      return me;
    };
    let m: RegExpMatchArray | null;

    // auth
    if (method === 'POST' && path === '/auth/register') return ok(this.register(json), 201);
    if (method === 'POST' && path === '/auth/login') return ok(this.login(json));
    if (method === 'POST' && path === '/auth/logout') {
      const token = headers.authorization?.slice(7);
      if (token) delete this.db.sessions[token];
      return ok(undefined, 204);
    }
    if (method === 'GET' && path === '/auth/me') return ok(publicUser(need()));

    // products
    if (method === 'GET' && path === '/products') return ok(this.listProducts(url));
    if (method === 'GET' && path === '/products/categories') {
      return ok([...new Set(this.approved().map((p) => p.category))].sort());
    }
    if (method === 'GET' && path === '/products/mine') {
      const seller = need('SELLER', 'ADMIN');
      const mine = this.db.products.filter((p) => p.sellerId === seller.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return ok(paginate(mine, url, 50));
    }
    if ((m = path.match(/^\/products\/(\d+)$/))) {
      const id = Number(m[1]);
      if (method === 'GET') return ok(this.visibleProduct(id, me));
      if (method === 'PATCH') return ok(await this.updateProduct(id, need('SELLER', 'ADMIN'), body as FormData));
      if (method === 'DELETE') {
        this.ownedProduct(id, need('SELLER', 'ADMIN')).status = 'ARCHIVED';
        return ok(undefined, 204);
      }
    }
    if (method === 'POST' && path === '/products') return ok(await this.createProduct(need('SELLER'), body as FormData), 201);
    if (method === 'POST' && (m = path.match(/^\/products\/(\d+)\/stock$/))) {
      const p = this.ownedProduct(Number(m[1]), need('SELLER', 'ADMIN'));
      const delta = Number(json.delta);
      if (!Number.isInteger(delta) || delta === 0) throw fail(400, 'delta must be a non-zero integer');
      if (p.stock + delta < 0) throw fail(409, 'Stock cannot go below zero', { code: 'INSUFFICIENT_STOCK' });
      p.stock += delta;
      return ok(p);
    }

    // cart
    if (path === '/cart' && method === 'GET') return ok(this.cartView(need().id));
    if (path === '/cart' && method === 'DELETE') {
      const u = need();
      this.db.cart = this.db.cart.filter((c) => c.userId !== u.id);
      return ok(undefined, 204);
    }
    if (path === '/cart/items' && method === 'POST') {
      const u = need();
      const productId = Number(json.productId);
      const quantity = Number(json.quantity ?? 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw fail(400, 'quantity must be 1–99');
      if (!this.approved().some((p) => p.id === productId)) throw fail(404, 'Product not found or not on sale');
      const row = this.db.cart.find((c) => c.userId === u.id && c.productId === productId);
      if (row) row.quantity = Math.min(99, row.quantity + quantity);
      else this.db.cart.push({ userId: u.id, productId, quantity });
      return ok(this.cartView(u.id));
    }
    if ((m = path.match(/^\/cart\/items\/(\d+)$/))) {
      const u = need();
      const productId = Number(m[1]);
      if (method === 'PATCH') {
        const row = this.db.cart.find((c) => c.userId === u.id && c.productId === productId);
        if (!row) throw fail(404, 'Item is not in your cart');
        const quantity = Number(json.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw fail(400, 'quantity must be 1–99');
        row.quantity = quantity;
        return ok(this.cartView(u.id));
      }
      if (method === 'DELETE') {
        this.db.cart = this.db.cart.filter((c) => !(c.userId === u.id && c.productId === productId));
        return ok(this.cartView(u.id));
      }
    }

    // orders
    if (method === 'POST' && path === '/orders') {
      const u = need();
      const { order, replayed } = this.placeOrder(u, headers['idempotency-key'], json);
      return replayed
        ? ok(this.present(order, u), 200, { 'Idempotent-Replayed': 'true' })
        : ok(this.present(order, u), 201);
    }
    if (method === 'GET' && path === '/orders') {
      const u = need();
      return ok(this.orderPage(this.db.orders.filter((o) => o.userId === u.id), url, u));
    }
    if (method === 'GET' && path === '/orders/sales') {
      const u = need('SELLER');
      const mine = this.db.orders
        .filter((o) => o.items.some((i) => i.sellerId === u.id))
        .map((o) => ({ ...o, items: o.items.filter((i) => i.sellerId === u.id) }));
      return ok(this.orderPage(mine, url, u));
    }
    if ((m = path.match(/^\/orders\/([0-9a-f-]{36})$/)) && method === 'GET') {
      const u = need();
      return ok(this.present(this.viewableOrder(m[1], u), u));
    }
    if ((m = path.match(/^\/orders\/([0-9a-f-]{36})\/(pay|cancel|ship|confirm)$/)) && method === 'POST') {
      const u = need();
      const event = m[2].toUpperCase() as OrderAction;
      if (event === 'SHIP' && u.role === 'BUYER') throw fail(403, 'Requires role: SELLER or ADMIN');
      const order = this.transition(m[1], event, u, typeof json.reason === 'string' ? json.reason : undefined);
      return ok(this.present(order, u));
    }

    // admin
    if (method === 'GET' && path === '/admin/products') {
      need('ADMIN');
      const status = url.searchParams.get('status');
      const list = this.db.products
        .filter((p) => !status || p.status === status)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      return ok(paginate(list, url, 20));
    }
    if (method === 'POST' && (m = path.match(/^\/admin\/products\/(\d+)\/(approve|reject)$/))) {
      need('ADMIN');
      const id = Number(m[1]);
      const p = this.db.products.find((x) => x.id === id);
      if (!p) throw fail(404, 'Product not found');
      if (p.status !== 'PENDING') {
        throw fail(409, 'Only products awaiting review can be approved or rejected', { code: 'NOT_PENDING' });
      }
      const reason = typeof json.reason === 'string' ? json.reason.trim() : '';
      if (m[2] === 'reject' && !reason) throw fail(400, 'reason is required');
      p.status = m[2] === 'approve' ? 'APPROVED' : 'REJECTED';
      p.reviewNote = m[2] === 'reject' ? reason : null;
      return ok(p);
    }
    if (method === 'GET' && path === '/admin/orders') {
      const admin = need('ADMIN');
      return ok(this.orderPage(this.db.orders, url, admin));
    }
    if (method === 'GET' && path === '/admin/users') {
      need('ADMIN');
      return ok(paginate(this.db.users.map(publicUser), url, 20));
    }
    if (method === 'GET' && path === '/health') return ok({ status: 'ok', db: 'demo', redis: 'demo' });

    throw fail(404, `Cannot ${method} /api${path}`);
  }

  // ---------------------------------------------------------------- auth

  private authenticate(headers: Record<string, string>): DemoUser | undefined {
    const token = headers.authorization?.startsWith('Bearer ') ? headers.authorization.slice(7) : undefined;
    const userId = token ? this.db.sessions[token] : undefined;
    return userId ? this.db.users.find((u) => u.id === userId) : undefined;
  }

  private issue(user: DemoUser) {
    const token = `demo.${user.id}.${crypto.randomUUID()}`;
    this.db.sessions[token] = user.id;
    return { accessToken: token, expiresIn: 7200, user: publicUser(user) };
  }

  private register(body: Record<string, unknown>) {
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    const role = (body.role ?? 'BUYER') as Role;
    if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) throw fail(400, 'username must be 3–50 letters, digits, _ . or -');
    if (password.length < 8) throw fail(400, 'password must be 8–72 characters');
    if (role !== 'BUYER' && role !== 'SELLER') throw fail(400, 'role must be BUYER or SELLER');
    if (this.db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw fail(409, 'Username is already taken', { code: 'USERNAME_TAKEN' });
    }
    const user: DemoUser = {
      id: this.nextId(),
      username,
      password,
      role,
      phone: typeof body.phone === 'string' ? body.phone : null,
      createdAt: this.iso(),
    };
    this.db.users.push(user);
    return this.issue(user);
  }

  private login(body: Record<string, unknown>) {
    const username = String(body.username ?? '');
    const key = username.toLowerCase();
    if ((this.db.failedLogins[key] ?? 0) >= 5) {
      throw fail(429, 'Too many failed attempts, try again in 15 minutes', { code: 'TOO_MANY_ATTEMPTS' });
    }
    const user = this.db.users.find((u) => u.username === username);
    if (!user || user.password !== body.password) {
      this.db.failedLogins[key] = (this.db.failedLogins[key] ?? 0) + 1;
      throw fail(401, 'Wrong username or password', { code: 'BAD_CREDENTIALS' });
    }
    delete this.db.failedLogins[key];
    return this.issue(user);
  }

  // ---------------------------------------------------------------- products

  private approved(): Product[] {
    return this.db.products.filter((p) => p.status === 'APPROVED');
  }

  private listProducts(url: URL): Paginated<Product> {
    const q = url.searchParams.get('q')?.trim().toLowerCase();
    const category = url.searchParams.get('category');
    const sort = url.searchParams.get('sort') ?? 'newest';
    const list = this.approved()
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
      .filter((p) => !category || p.category === category)
      .sort((a, b) =>
        sort === 'price_asc'
          ? a.priceCents - b.priceCents
          : sort === 'price_desc'
            ? b.priceCents - a.priceCents
            : b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
      );
    return paginate(list, url);
  }

  private visibleProduct(id: number, me?: DemoUser): Product {
    const p = this.db.products.find((x) => x.id === id);
    if (!p || (p.status !== 'APPROVED' && me?.role !== 'ADMIN' && p.sellerId !== me?.id)) {
      throw fail(404, 'Product not found');
    }
    return p;
  }

  private ownedProduct(id: number, me: DemoUser): Product {
    const p = this.db.products.find((x) => x.id === id);
    if (!p) throw fail(404, 'Product not found');
    if (p.sellerId !== me.id && me.role !== 'ADMIN') throw fail(403, 'You can only manage your own products');
    return p;
  }

  private async readImages(form: FormData): Promise<string[]> {
    const files = form.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > 5) throw fail(400, 'At most 5 images are allowed');
    const urls: string[] = [];
    for (const file of files) {
      if (file.size > MAX_DEMO_IMAGE_BYTES) {
        throw fail(400, `${file.name} is too large for the demo (1.5 MB max; the real server allows 5 MB)`);
      }
      const head = new Uint8Array(await read<ArrayBuffer>(file.slice(0, 12), 'readAsArrayBuffer'));
      if (!sniffImage(head)) throw fail(400, `${file.name} is not a JPEG, PNG or WebP image`);
      urls.push(await toDataUrl(file));
    }
    return urls;
  }

  private async createProduct(seller: DemoUser, form: FormData): Promise<Product> {
    const name = String(form.get('name') ?? '').trim();
    const priceCents = parsePrice(String(form.get('price') ?? ''));
    const stock = Number(form.get('stock'));
    if (!name) throw fail(400, 'name is required');
    if (priceCents === null) throw fail(400, 'price must be a positive amount with at most 2 decimals, e.g. "19.99"');
    if (!Number.isInteger(stock) || stock < 0) throw fail(400, 'stock must be a whole number ≥ 0');
    const images = await this.readImages(form);
    const product: Product = {
      id: this.nextId(),
      sellerId: seller.id,
      seller: { id: seller.id, username: seller.username },
      name,
      description: String(form.get('description') ?? '').trim(),
      priceCents,
      stock,
      category: String(form.get('category') ?? '').trim() || 'General',
      images,
      status: 'PENDING',
      reviewNote: null,
      createdAt: this.iso(),
      updatedAt: this.iso(),
    };
    this.db.products.push(product);
    return product;
  }

  private async updateProduct(id: number, me: DemoUser, form: FormData): Promise<Product> {
    const p = this.ownedProduct(id, me);
    if (p.status === 'ARCHIVED') throw fail(409, 'Archived products cannot be edited');
    const images = await this.readImages(form);
    const str = (k: string) => (form.has(k) ? String(form.get(k)).trim() : undefined);
    const price = str('price');
    if (price !== undefined) {
      const cents = parsePrice(price);
      if (cents === null) throw fail(400, 'price must be a positive amount with at most 2 decimals');
      p.priceCents = cents;
    }
    p.name = str('name') || p.name;
    p.description = str('description') ?? p.description;
    p.category = str('category') || p.category;
    if (images.length) p.images = images;
    if (me.role !== 'ADMIN') {
      p.status = 'PENDING';
      p.reviewNote = null;
    }
    p.updatedAt = this.iso();
    return p;
  }

  // ---------------------------------------------------------------- cart

  private cartView(userId: number): Cart {
    const items: CartLine[] = this.db.cart
      .filter((c) => c.userId === userId)
      .flatMap((c) => {
        const p = this.db.products.find((x) => x.id === c.productId);
        if (!p) return [];
        return [
          {
            productId: c.productId,
            quantity: c.quantity,
            available: p.status === 'APPROVED' && p.stock >= c.quantity,
            subtotalCents: p.priceCents * c.quantity,
            product: {
              id: p.id,
              name: p.name,
              priceCents: p.priceCents,
              stock: p.stock,
              images: p.images,
              status: p.status,
              sellerId: p.sellerId,
            },
          },
        ];
      });
    const totalCents = items.filter((i) => i.available).reduce((s, i) => s + i.subtotalCents, 0);
    return { items, totalCents };
  }

  // ---------------------------------------------------------------- orders

  private placeOrder(
    user: DemoUser,
    key: string | undefined,
    body: Record<string, unknown>,
  ): { order: DemoOrder; replayed: boolean } {
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      throw fail(400, 'Send an Idempotency-Key header: 8–128 characters of letters, digits, _ or -', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      });
    }
    const raw = Array.isArray(body.items) ? (body.items as Array<{ productId: number; quantity: number }>) : [];
    if (!raw.length) throw fail(400, 'items must contain at least 1 element');
    const lines = normalizeLines(raw.map((l) => ({ productId: Number(l.productId), quantity: Number(l.quantity) })));
    if (lines.some((l) => !Number.isInteger(l.productId) || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 99)) {
      throw fail(400, 'each item needs a productId and a quantity of 1–99');
    }
    const hash = lines.map((l) => `${l.productId}x${l.quantity}`).join(',');

    // Idempotency: the (user, key) pair is unique, exactly like the database constraint.
    const existing = this.db.orders.find((o) => o.userId === user.id && o.idempotencyKey === key);
    if (existing) {
      if (existing.requestHash !== hash) {
        throw fail(422, 'This Idempotency-Key was already used for a different request', {
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
      }
      return { order: existing, replayed: true };
    }

    // Validate every line before touching stock, so the whole order is all-or-nothing.
    const picked = lines.map((line) => {
      const p = this.db.products.find((x) => x.id === line.productId);
      if (!p || p.status !== 'APPROVED') {
        throw fail(409, `Product ${line.productId} is not on sale`, { code: 'PRODUCT_UNAVAILABLE', productId: line.productId });
      }
      if (p.sellerId === user.id) throw fail(400, `You cannot buy your own product "${p.name}"`, { code: 'OWN_PRODUCT' });
      if (p.stock < line.quantity) {
        throw fail(409, `Only ${p.stock} left of "${p.name}"`, { code: 'INSUFFICIENT_STOCK', productId: p.id, available: p.stock });
      }
      return { p, line };
    });

    const orderId = crypto.randomUUID();
    const items: OrderItem[] = picked.map(({ p, line }) => {
      p.stock -= line.quantity;
      return {
        id: this.nextId(),
        productId: p.id,
        sellerId: p.sellerId,
        productName: p.name,
        productImage: p.images[0] ?? null,
        unitPriceCents: p.priceCents,
        quantity: line.quantity,
      };
    });
    const order: DemoOrder = {
      id: orderId,
      userId: user.id,
      status: 'PENDING_PAYMENT',
      totalCents: items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0),
      expiresAt: new Date(this.now() + DEMO_PAYMENT_TTL_MS).toISOString(),
      paidAt: null,
      shippedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
      createdAt: this.iso(),
      items,
      idempotencyKey: key,
      requestHash: hash,
    };
    this.db.orders.push(order);
    if (body.clearCartItems) {
      const bought = new Set(lines.map((l) => l.productId));
      this.db.cart = this.db.cart.filter((c) => !(c.userId === user.id && bought.has(c.productId)));
    }
    return { order, replayed: false };
  }

  private canView(o: DemoOrder, u: DemoUser): boolean {
    return u.role === 'ADMIN' || o.userId === u.id || o.items.some((i) => i.sellerId === u.id);
  }

  private viewableOrder(id: string, u: DemoUser): DemoOrder {
    const o = this.db.orders.find((x) => x.id === id);
    if (!o || !this.canView(o, u)) throw fail(404, 'Order not found');
    return o;
  }

  private isAllowed(o: DemoOrder, event: OrderEvent, actor: DemoUser | null): boolean {
    if (event === 'EXPIRE') return actor === null;
    if (!actor) return false;
    const owner = o.userId === actor.id;
    switch (event) {
      case 'PAY':
      case 'CONFIRM':
        return owner;
      case 'CANCEL':
        return owner || actor.role === 'ADMIN';
      case 'SHIP':
        return actor.role === 'ADMIN' || (actor.role === 'SELLER' && o.items.every((i) => i.sellerId === actor.id));
    }
  }

  private transition(id: string, event: OrderEvent, actor: DemoUser | null, reason?: string): DemoOrder {
    const o = this.db.orders.find((x) => x.id === id);
    if (!o || (actor && !this.canView(o, actor))) throw fail(404, 'Order not found');
    if (!this.isAllowed(o, event, actor)) throw fail(403, `You are not allowed to ${event.toLowerCase()} this order`);
    const to = TRANSITIONS[o.status][event];
    if (!to) throw fail(409, `Cannot ${event} an order that is ${o.status}`, { code: 'ILLEGAL_TRANSITION', status: o.status });
    if (event === 'PAY' && Date.parse(o.expiresAt) <= this.now()) {
      throw fail(409, 'The payment window for this order has closed', { code: 'ORDER_EXPIRED' });
    }
    const at = this.iso();
    o.status = to;
    if (event === 'PAY') o.paidAt = at;
    if (event === 'SHIP') o.shippedAt = at;
    if (event === 'CONFIRM') o.completedAt = at;
    if (event === 'CANCEL' || event === 'EXPIRE') {
      o.cancelledAt = at;
      o.cancelReason = event === 'EXPIRE' ? 'Payment window expired' : reason?.trim() || 'Cancelled by request';
      for (const item of o.items) {
        const p = this.db.products.find((x) => x.id === item.productId);
        if (p) p.stock += item.quantity;
      }
    }
    return o;
  }

  /** The demo's version of the BullMQ job + sweeper: runs before every request. */
  expireOverdue(): number {
    let n = 0;
    for (const o of this.db.orders) {
      if (o.status === 'PENDING_PAYMENT' && Date.parse(o.expiresAt) <= this.now()) {
        this.transition(o.id, 'EXPIRE', null);
        n++;
      }
    }
    if (n) this.save();
    return n;
  }

  private present(o: DemoOrder, viewer: DemoUser): Order {
    const { idempotencyKey: _k, requestHash: _h, ...rest } = o;
    const actions = (Object.keys(TRANSITIONS[o.status]) as OrderEvent[]).filter(
      (e): e is OrderAction => e !== 'EXPIRE' && this.isAllowed(o, e, viewer),
    );
    return { ...rest, items: [...rest.items], actions };
  }

  private orderPage(list: DemoOrder[], url: URL, viewer: DemoUser): Paginated<Order> {
    const status = url.searchParams.get('status');
    const filtered = list
      .filter((o) => !status || o.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = paginate(filtered, url, 20);
    return { ...page, items: page.items.map((o) => this.present(o, viewer)) };
  }

  /** Test helper. */
  stockOf(productId: number): number | undefined {
    return this.db.products.find((p) => p.id === productId)?.stock;
  }
}

// ------------------------------------------------------------------ fetch shim

function headerRecord(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

let instance: DemoServer | null = null;

export function demoServer(): DemoServer {
  if (!instance) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    instance = new DemoServer({ storage });
  }
  return instance;
}

/** Routes every `/api/*` fetch to the in-browser server; everything else goes to the network. */
export function installDemoServer(latencyMs = 200): void {
  const server = demoServer();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);

    await new Promise((resolve) => setTimeout(resolve, latencyMs));
    let body: unknown = init?.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const res = await server.handle({ method: init?.method ?? 'GET', url, headers: headerRecord(init), body });
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json', ...res.headers },
    });
  };
  window.setInterval(() => server.expireOverdue(), 5000);
}
