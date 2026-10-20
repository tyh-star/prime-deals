import type { OrderStatus } from '../api/types';

const currency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

export function formatMoney(cents: number): string {
  return currency.format(cents / 100);
}

/** Splits "$1,234.50" into the parts a shelf tag sets at different sizes. */
export function priceParts(cents: number): { major: string; minor: string } {
  const major = Math.floor(cents / 100).toLocaleString('en-CA');
  const minor = String(cents % 100).padStart(2, '0');
  return { major, minor };
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  SHIPPED: 'Shipped',
  COMPLETED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
