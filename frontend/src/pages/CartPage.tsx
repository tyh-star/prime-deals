import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import type { CartLine } from '../api/types';
import { EmptyState, ErrorNote, errorCode, PriceTag, ProductArt, QuantityStepper } from '../components/ui';
import { formatMoney } from '../lib/format';
import { useCheckoutKey } from '../lib/useCheckoutKey';

function CartRow({ line }: { line: CartLine }) {
  const queryClient = useQueryClient();
  const setCart = (cart: unknown) => queryClient.setQueryData(['cart'], cart);
  const update = useMutation({
    mutationFn: (quantity: number) => api.setCartQuantity(line.productId, quantity),
    onSuccess: setCart,
  });
  const remove = useMutation({ mutationFn: () => api.removeFromCart(line.productId), onSuccess: setCart });
  const p = line.product;
  const reason =
    p.status !== 'APPROVED' ? 'No longer on sale' : p.stock < line.quantity ? `Only ${p.stock} left` : null;

  return (
    <li className={`cart-row ${line.available ? '' : 'unavailable'}`}>
      <Link to={`/products/${p.id}`} className="cart-art">
        <ProductArt src={p.images[0]} name={p.name} />
      </Link>
      <div className="cart-main">
        <Link to={`/products/${p.id}`} className="cart-name">
          {p.name}
        </Link>
        <PriceTag cents={p.priceCents} size="sm" />
        {reason && <p className="stock out">{reason}</p>}
        <ErrorNote error={update.error ?? remove.error} />
      </div>
      <div className="cart-controls">
        <QuantityStepper
          value={line.quantity}
          max={Math.max(1, Math.min(99, p.stock || line.quantity))}
          onChange={(q) => update.mutate(q)}
          disabled={update.isPending}
          label={`Quantity of ${p.name}`}
        />
        <button className="link-button" onClick={() => remove.mutate()} disabled={remove.isPending}>
          Remove
        </button>
      </div>
      <p className="cart-subtotal">{formatMoney(line.subtotalCents)}</p>
    </li>
  );
}

export function CartPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const cart = useQuery({ queryKey: ['cart'], queryFn: api.cart });

  const buyable = cart.data?.items.filter((i) => i.available) ?? [];
  const fingerprint = buyable.map((i) => `${i.productId}x${i.quantity}`).join(',');
  const { keyFor, reset } = useCheckoutKey(fingerprint);

  const checkout = useMutation({
    mutationFn: () =>
      api.placeOrder(
        buyable.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        keyFor(),
      ),
    onSuccess: ({ order }) => {
      reset();
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate(`/orders/${order.id}`);
    },
    onError: (error) => {
      // Stock changed under us: refresh so the cart shows what is actually available.
      if (errorCode(error) === 'INSUFFICIENT_STOCK' || errorCode(error) === 'PRODUCT_UNAVAILABLE') {
        queryClient.invalidateQueries({ queryKey: ['cart'] });
      }
    },
  });

  if (cart.isLoading) return <p className="muted pad">Loading…</p>;
  const items = cart.data?.items ?? [];

  if (items.length === 0) {
    return (
      <section className="page narrow">
        <h1>Your cart</h1>
        <EmptyState title="Your cart is empty">
          <Link to="/" className="btn btn-ink">
            Browse deals
          </Link>
        </EmptyState>
      </section>
    );
  }

  const unavailable = items.length - buyable.length;

  return (
    <section className="page cart">
      <h1>Your cart</h1>
      <ErrorNote error={cart.error} />
      <ul className="cart-list">
        {items.map((line) => (
          <CartRow key={line.productId} line={line} />
        ))}
      </ul>
      <div className="checkout">
        {unavailable > 0 && (
          <p className="muted">
            {unavailable === 1 ? '1 item is' : `${unavailable} items are`} unavailable and won’t be ordered.
          </p>
        )}
        <p className="total">
          Total <PriceTag cents={cart.data?.totalCents ?? 0} />
        </p>
        <p className="muted">Stock is reserved when you place the order. You then have 15 minutes to pay.</p>
        <ErrorNote error={checkout.error} />
        <button
          className="btn btn-ink btn-block"
          disabled={buyable.length === 0 || checkout.isPending}
          onClick={() => checkout.mutate()}
        >
          {checkout.isPending ? 'Placing order…' : 'Place order'}
        </button>
      </div>
    </section>
  );
}
