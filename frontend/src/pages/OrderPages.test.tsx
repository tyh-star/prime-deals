import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Order } from '../api/types';
import { mockApi, renderAt } from '../test/utils';
import { OrderDetailPage } from './OrderPages';

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: '3f2a9c1e-0000-4000-8000-000000000000',
    userId: 1,
    status: 'PENDING_PAYMENT',
    totalCents: 2500,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    paidAt: null,
    shippedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date().toISOString(),
    items: [
      { id: 1, productId: 7, sellerId: 2, productName: 'Mug', productImage: null, unitPriceCents: 1250, quantity: 2 },
    ],
    actions: ['PAY', 'CANCEL'],
    ...overrides,
  };
}

const routes = [{ path: '/orders/:id', element: <OrderDetailPage /> }];

describe('OrderDetailPage', () => {
  beforeEach(() => localStorage.setItem('pd.token', 'token'));

  it('shows the countdown and only the actions the server allows', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ body: { id: 1, username: 'b', role: 'BUYER' } }),
      'GET /api/orders/3f2a9c1e-0000-4000-8000-000000000000': () => ({ body: order() }),
    });
    renderAt('/orders/3f2a9c1e-0000-4000-8000-000000000000', routes);

    expect(await screen.findByRole('heading', { name: 'Order 3F2A9C1E' })).toBeInTheDocument();
    expect(screen.getByText(/Pay within/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as shipped' })).not.toBeInTheDocument();
  });

  it('pays and moves the track forward', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ body: { id: 1, username: 'b', role: 'BUYER' } }),
      'GET /api/orders/3f2a9c1e-0000-4000-8000-000000000000': () => ({ body: order() }),
      'POST /api/orders/3f2a9c1e-0000-4000-8000-000000000000/pay': () => ({
        body: order({ status: 'PAID', paidAt: new Date().toISOString(), actions: [] }),
      }),
    });
    renderAt('/orders/3f2a9c1e-0000-4000-8000-000000000000', routes);

    await userEvent.click(await screen.findByRole('button', { name: 'Pay now' }));
    expect(await screen.findByText('Paid', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Pay within/)).not.toBeInTheDocument();
    expect(calls.some((c) => c.key.endsWith('/pay'))).toBe(true);
  });

  it('explains a cancellation', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ body: { id: 1, username: 'b', role: 'BUYER' } }),
      'GET /api/orders/3f2a9c1e-0000-4000-8000-000000000000': () => ({
        body: order({
          status: 'CANCELLED',
          cancelReason: 'Payment window expired',
          cancelledAt: new Date().toISOString(),
          actions: [],
        }),
      }),
    });
    renderAt('/orders/3f2a9c1e-0000-4000-8000-000000000000', routes);
    expect(await screen.findByText(/Payment window expired\. Items were returned to stock\./)).toBeInTheDocument();
  });
});
