import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { ErrorNote, PriceTag, ProductArt, QuantityStepper } from '../components/ui';

export function ProductPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(1);
  const [shown, setShown] = useState(0);

  const product = useQuery({ queryKey: ['product', id], queryFn: () => api.product(id) });
  const add = useMutation({
    mutationFn: () => api.addToCart(id, qty),
    onSuccess: (cart) => queryClient.setQueryData(['cart'], cart),
  });

  if (product.isLoading) return <p className="muted pad">Loading…</p>;
  if (product.error || !product.data) {
    return (
      <section className="page narrow">
        <h1>Product not found</h1>
        <p className="muted">It may have been taken off sale.</p>
        <Link to="/">Back to all deals</Link>
      </section>
    );
  }

  const p = product.data;
  const soldOut = p.stock === 0;
  const isOwn = user?.id === p.sellerId;

  return (
    <article className="page product">
      <div className="gallery">
        <ProductArt src={p.images[shown]} name={p.name} category={p.category} />
        {p.images.length > 1 && (
          <div className="thumbs">
            {p.images.map((src, i) => (
              <button key={src} onClick={() => setShown(i)} aria-label={`Show image ${i + 1}`} aria-pressed={i === shown}>
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="product-info">
        <p className="muted">
          <Link to={`/?category=${encodeURIComponent(p.category)}`}>{p.category}</Link>
          {p.seller && <> — sold by {p.seller.username}</>}
        </p>
        <h1>{p.name}</h1>
        <PriceTag cents={p.priceCents} size="lg" />
        {p.status !== 'APPROVED' && (
          <p className="notice">This listing is {p.status.toLowerCase()} and only visible to you.</p>
        )}
        <p className="description">{p.description || 'No description provided.'}</p>
        <p className={`stock ${soldOut ? 'out' : p.stock <= 5 ? 'low' : ''}`}>
          {soldOut ? 'Sold out' : `${p.stock} in stock`}
        </p>

        {!isOwn && p.status === 'APPROVED' && !soldOut && (
          <div className="buy-row">
            <QuantityStepper value={qty} max={Math.min(p.stock, 99)} onChange={setQty} />
            <button
              className="btn btn-ink"
              disabled={add.isPending}
              onClick={() => (user ? add.mutate() : navigate('/login', { state: { from: `/products/${id}` } }))}
            >
              {add.isPending ? 'Adding…' : 'Add to cart'}
            </button>
          </div>
        )}
        {add.isSuccess && (
          <p className="ok" role="status">
            Added to cart. <Link to="/cart">Go to cart</Link>
          </p>
        )}
        <ErrorNote error={add.error} />
      </div>
    </article>
  );
}
