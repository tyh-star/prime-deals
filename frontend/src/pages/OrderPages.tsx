import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/endpoints';
import type { Order, OrderAction, OrderStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  ConfirmButton,
  Countdown,
  EmptyState,
  ErrorNote,
  OrderTrack,
  Pagination,
  ProductArt,
  StatusPill,
} from '../components/ui';
import { formatDateTime, formatMoney, ORDER_STATUS_LABEL, shortId } from '../lib/format';

const ACTION_LABEL: Record<OrderAction, string> = {
  PAY: 'Pay now',
  CANCEL: 'Cancel order',
  SHIP: 'Mark as shipped',
  CONFIRM: 'Confirm delivery',
};

/** Buttons come from `order.actions`, which the server derives from its state machine. */
export function OrderActions({ order, onDone }: { order: Order; onDone?: (o: Order) => void }) {
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (action: OrderAction) => api.orderAction(order.id, action),
    onSuccess: (updated) => {
      queryClient.setQueryData(['order', order.id], updated);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      onDone?.(updated);
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['order', order.id] }),
  });
  if (order.actions.length === 0) return null;
  return (
    <div className="actions">
      {order.actions.map((action) =>
        action === 'CANCEL' ? (
          <ConfirmButton
            key={action}
            label={ACTION_LABEL.CANCEL}
            question="Cancel this order? The items go back on sale."
            confirmLabel="Yes, cancel order"
            disabled={act.isPending}
            onConfirm={() => act.mutate(action)}
          />
        ) : (
          <button key={action} className="btn btn-ink" disabled={act.isPending} onClick={() => act.mutate(action)}>
            {act.isPending && act.variables === action ? 'Working…' : ACTION_LABEL[action]}
          </button>
        ),
      )}
      <ErrorNote error={act.error} />
    </div>
  );
}

export function OrderDetailPage() {
  const id = useParams().id as string;
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.order(id) });
  const refresh = useCallback(
    // The server cancels expired orders; re-read a moment after the deadline passes.
    () => setTimeout(() => queryClient.invalidateQueries({ queryKey: ['order', id] }), 1500),
    [queryClient, id],
  );

  if (order.isLoading) return <p className="muted pad">Loading…</p>;
  if (!order.data) {
    return (
      <section className="page narrow">
        <h1>Order not found</h1>
        <Link to="/orders">Back to your orders</Link>
      </section>
    );
  }
  const o = order.data;

  return (
    <section className="page order">
      <p className="muted">
        <Link to="/orders">Orders</Link> / {shortId(o.id)}
      </p>
      <h1>Order {shortId(o.id)}</h1>
      <OrderTrack status={o.status} />
      {o.status === 'PENDING_PAYMENT' && <Countdown until={o.expiresAt} onExpire={refresh} />}
      {o.status === 'CANCELLED' && <p className="notice">{o.cancelReason ?? 'Cancelled'}. Items were returned to stock.</p>}

      <ul className="line-items">
        {o.items.map((item) => (
          <li key={item.id}>
            <ProductArt src={item.productImage} name={item.productName} />
            <Link to={`/products/${item.productId}`}>{item.productName}</Link>
            <span className="muted">
              {item.quantity} × {formatMoney(item.unitPriceCents)}
            </span>
            <span>{formatMoney(item.quantity * item.unitPriceCents)}</span>
          </li>
        ))}
      </ul>
      <p className="total">
        Total <strong>{formatMoney(o.totalCents)}</strong>
      </p>
      <OrderActions order={o} />

      <dl className="timeline">
        <dt>Placed</dt>
        <dd>{formatDateTime(o.createdAt)}</dd>
        {o.paidAt && (
          <>
            <dt>Paid</dt>
            <dd>{formatDateTime(o.paidAt)}</dd>
          </>
        )}
        {o.shippedAt && (
          <>
            <dt>Shipped</dt>
            <dd>{formatDateTime(o.shippedAt)}</dd>
          </>
        )}
        {o.completedAt && (
          <>
            <dt>Delivered</dt>
            <dd>{formatDateTime(o.completedAt)}</dd>
          </>
        )}
        {o.cancelledAt && (
          <>
            <dt>Cancelled</dt>
            <dd>{formatDateTime(o.cancelledAt)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

const FILTERS: Array<OrderStatus | undefined> = [
  undefined,
  'PENDING_PAYMENT',
  'PAID',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
];

export function OrderTable({
  title,
  queryKey,
  load,
  inlineActions = false,
}: {
  title: string;
  queryKey: string;
  load: (status: OrderStatus | undefined, page: number) => Promise<{ items: Order[]; total: number; page: number; pageSize: number }>;
  inlineActions?: boolean;
}) {
  const [status, setStatus] = useState<OrderStatus | undefined>();
  const [page, setPage] = useState(1);
  const orders = useQuery({
    queryKey: [queryKey, status, page],
    queryFn: () => load(status, page),
    placeholderData: keepPreviousData,
  });

  return (
    <section className="page">
      <h1>{title}</h1>
      <div className="filters" role="tablist" aria-label="Filter by status">
        {FILTERS.map((s) => (
          <button
            key={s ?? 'all'}
            role="tab"
            aria-selected={status === s}
            className={status === s ? 'active' : ''}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s ? ORDER_STATUS_LABEL[s] : 'All'}
          </button>
        ))}
      </div>
      <ErrorNote error={orders.error} />
      {orders.data?.items.length === 0 && <EmptyState title="No orders here yet" />}
      <ul className="order-list">
        {orders.data?.items.map((o) => (
          <li key={o.id}>
            <Link to={`/orders/${o.id}`} className="order-link">
              <span className="order-id">{shortId(o.id)}</span>
              <span className="muted">{formatDateTime(o.createdAt)}</span>
              <span>
                {o.items.map((i) => i.productName).join(', ')}
              </span>
              <StatusPill status={o.status} />
              <span className="order-total">{formatMoney(o.totalCents)}</span>
            </Link>
            {inlineActions && <OrderActions order={o} />}
          </li>
        ))}
      </ul>
      {orders.data && (
        <Pagination page={orders.data.page} pageSize={orders.data.pageSize} total={orders.data.total} onPage={setPage} />
      )}
    </section>
  );
}

export function OrdersPage() {
  const { hasRole } = useAuth();
  return (
    <OrderTable
      title={hasRole('ADMIN') ? 'All orders' : 'Your orders'}
      queryKey={hasRole('ADMIN') ? 'all-orders' : 'orders'}
      load={hasRole('ADMIN') ? api.allOrders : api.orders}
      inlineActions={hasRole('ADMIN')}
    />
  );
}
