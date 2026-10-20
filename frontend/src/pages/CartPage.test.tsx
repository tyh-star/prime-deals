import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Cart } from '../api/types';
import { mockApi, renderAt } from '../test/utils';
import { CartPage } from './CartPage';

const cart: Cart = {
  totalCents: 2 * 1250 + 300,
  items: [
    {
      productId: 1,
      quantity: 2,
      available: true,
      subtotalCents: 2500,
      product: { id: 1, name: 'Mug', priceCents: 1250, stock: 10, images: [], status: 'APPROVED', sellerId: 9 },
    },
    {
      productId: 2,
      quantity: 1,
      available: true,
      subtotalCents: 300,
      product: { id: 2, name: 'Tea', priceCents: 300, stock: 4, images: [], status: 'APPROVED', sellerId: 9 },
    },
    {
      productId: 3,
      quantity: 1,
      available: false,
      subtotalCents: 999,
      product: { id: 3, name: 'Gone', priceCents: 999, stock: 0, images: [], status: 'ARCHIVED', sellerId: 9 },
    },
  ],
};

const routes = [
  { path: '/cart', element: <CartPage /> },
  { path: '/orders/:id', element: <p>Order page</p> },
];

describe('CartPage checkout', () => {
  it('orders only available lines, sends an Idempotency-Key and opens the order', async () => {
    const { calls } = mockApi({
      'GET /api/cart': () => ({ body: cart }),
      'POST /api/orders': () => ({ status: 201, body: { id: 'abc' } }),
    });
    renderAt('/cart', routes);

    expect(await screen.findByText('Mug')).toBeInTheDocument();
    expect(screen.getByText('No longer on sale')).toBeInTheDocument();
    expect(screen.getByText(/1 item is unavailable/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText('Order page')).toBeInTheDocument();

    const post = calls.find((c) => c.key === 'POST /api/orders');
    const headers = post?.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(post?.init.body))).toEqual({
      items: [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 1 },
      ],
      clearCartItems: true,
    });
  });

  it('retries with the same Idempotency-Key after a failure', async () => {
    let attempt = 0;
    const { calls } = mockApi({
      'GET /api/cart': () => ({ body: cart }),
      'POST /api/orders': () =>
        ++attempt === 1
          ? { status: 503, body: { message: 'Service unavailable' } }
          : { status: 200, body: { id: 'abc' }, headers: { 'Idempotent-Replayed': 'true' } },
    });
    renderAt('/cart', routes);

    const button = await screen.findByRole('button', { name: 'Place order' });
    await userEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await screen.findByText('Order page');

    const keys = calls
      .filter((c) => c.key === 'POST /api/orders')
      .map((c) => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('refreshes the cart when stock ran out meanwhile', async () => {
    let cartLoads = 0;
    mockApi({
      'GET /api/cart': () => {
        cartLoads++;
        return { body: cart };
      },
      'POST /api/orders': () => ({
        status: 409,
        body: { code: 'INSUFFICIENT_STOCK', message: 'Only 1 left of "Mug"' },
      }),
    });
    renderAt('/cart', routes);
    await userEvent.click(await screen.findByRole('button', { name: 'Place order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 1 left of "Mug"');
    await waitFor(() => expect(cartLoads).toBeGreaterThanOrEqual(2));
  });
});
