import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/endpoints';
import type { Product, ProductStatus } from '../api/types';
import { EmptyState, ErrorNote, Pagination, PriceTag, ProductArt } from '../components/ui';
import { formatDateTime } from '../lib/format';

function ReviewCard({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const done = () => queryClient.invalidateQueries({ queryKey: ['review'] });
  const approve = useMutation({ mutationFn: () => api.approve(product.id), onSuccess: done });
  const reject = useMutation({ mutationFn: () => api.reject(product.id, reason.trim()), onSuccess: done });
  const busy = approve.isPending || reject.isPending;

  return (
    <li className="review">
      <ProductArt src={product.images[0]} name={product.name} category={product.category} />
      <div className="review-body">
        <h3>{product.name}</h3>
        <p className="muted">
          {product.category}, from {product.seller?.username ?? `seller #${product.sellerId}`}, submitted{' '}
          {formatDateTime(product.updatedAt)}
        </p>
        <PriceTag cents={product.priceCents} size="sm" />
        <p className="description">{product.description || 'No description.'}</p>
        {product.images.length > 1 && (
          <div className="thumbs">
            {product.images.slice(1).map((src) => (
              <img key={src} src={src} alt="" />
            ))}
          </div>
        )}
        <ErrorNote error={approve.error ?? reject.error} />
        {product.status === 'PENDING' ? (
          rejecting ? (
            <form
              className="reject-form"
              onSubmit={(e) => {
                e.preventDefault();
                reject.mutate();
              }}
            >
              <label>
                Reason the seller will see
                <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} autoFocus />
              </label>
              <div className="actions">
                <button className="btn btn-danger" disabled={busy || !reason.trim()}>
                  Reject listing
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setRejecting(false)}>
                  Back
                </button>
              </div>
            </form>
          ) : (
            <div className="actions">
              <button className="btn btn-ink" disabled={busy} onClick={() => approve.mutate()}>
                Approve
              </button>
              <button className="btn btn-quiet" disabled={busy} onClick={() => setRejecting(true)}>
                Reject…
              </button>
            </div>
          )
        ) : (
          <p className="muted">
            {product.status.toLowerCase()}
            {product.reviewNote ? ` — ${product.reviewNote}` : ''}
          </p>
        )}
      </div>
    </li>
  );
}

const TABS: Array<{ status: ProductStatus | undefined; label: string }> = [
  { status: 'PENDING', label: 'Waiting' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'REJECTED', label: 'Rejected' },
  { status: undefined, label: 'All' },
];

export function AdminPage() {
  const [status, setStatus] = useState<ProductStatus | undefined>('PENDING');
  const [page, setPage] = useState(1);
  const queue = useQuery({
    queryKey: ['review', status, page],
    queryFn: () => api.reviewQueue(status, page),
    placeholderData: keepPreviousData,
  });

  return (
    <section className="page admin">
      <div className="shelf-head">
        <h1>Listing review</h1>
        <Link to="/orders" className="btn btn-quiet">
          All orders
        </Link>
      </div>
      <div className="filters" role="tablist" aria-label="Filter by review status">
        {TABS.map((t) => (
          <button
            key={t.label}
            role="tab"
            aria-selected={status === t.status}
            className={status === t.status ? 'active' : ''}
            onClick={() => {
              setStatus(t.status);
              setPage(1);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ErrorNote error={queue.error} />
      {queue.data?.items.length === 0 && (
        <EmptyState title={status === 'PENDING' ? 'Nothing waiting for review' : 'No listings here'} />
      )}
      <ul className="review-list">
        {queue.data?.items.map((p) => <ReviewCard key={p.id} product={p} />)}
      </ul>
      {queue.data && (
        <Pagination page={queue.data.page} pageSize={queue.data.pageSize} total={queue.data.total} onPage={setPage} />
      )}
    </section>
  );
}
