import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/endpoints';
import type { Product } from '../api/types';
import { EmptyState, ErrorNote, PriceTag, ProductArt } from '../components/ui';
import { OrderTable } from './OrderPages';

const STATUS_COPY: Record<Product['status'], string> = {
  PENDING: 'Waiting for review',
  APPROVED: 'On sale',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
};

const MAX_IMAGES = 5;
const MAX_BYTES = 5 * 1024 * 1024;

export function ProductForm({ product, onSaved }: { product?: Product; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const editing = !!product;

  const save = useMutation({
    mutationFn: (form: FormData) => (product ? api.updateProduct(product.id, form) : api.createProduct(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-products'] });
      onSaved();
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const form = new FormData();
    for (const key of ['name', 'description', 'price', 'category', ...(editing ? [] : ['stock'])]) {
      const value = String(data.get(key) ?? '').trim();
      if (value || key === 'description') form.append(key, value);
    }
    for (const file of files) form.append('images', file);
    save.mutate(form);
  };

  const pick = (list: FileList | null) => {
    const chosen = Array.from(list ?? []);
    if (chosen.length > MAX_IMAGES) return setFileError(`Choose at most ${MAX_IMAGES} images.`);
    if (chosen.some((f) => f.size > MAX_BYTES)) return setFileError('Each image must be 5 MB or smaller.');
    setFileError(null);
    setFiles(chosen);
  };

  return (
    <form className="form product-form" onSubmit={submit}>
      <label>
        Name
        <input name="name" required maxLength={200} defaultValue={product?.name} />
      </label>
      <label>
        Description
        <textarea name="description" rows={4} maxLength={5000} defaultValue={product?.description} />
      </label>
      <div className="form-row">
        <label>
          Price (CAD)
          <input
            name="price"
            required
            inputMode="decimal"
            pattern="\d{1,7}(\.\d{1,2})?"
            title="A positive amount like 19.99"
            defaultValue={product ? (product.priceCents / 100).toFixed(2) : ''}
          />
        </label>
        {!editing && (
          <label>
            Stock
            <input name="stock" type="number" min={0} max={1000000} required defaultValue={1} />
          </label>
        )}
        <label>
          Category
          <input name="category" maxLength={100} placeholder="General" defaultValue={product?.category} />
        </label>
      </div>
      <label>
        Images <span className="muted">(JPEG, PNG or WebP, up to 5{editing ? '; replaces current images' : ''})</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => pick(e.target.files)} />
      </label>
      {fileError && <p className="error-note">{fileError}</p>}
      <ErrorNote error={save.error} />
      <p className="muted">
        {editing ? 'Saving changes sends the listing back for review.' : 'New listings appear once an admin approves them.'}
      </p>
      <div className="actions">
        <button className="btn btn-ink" disabled={save.isPending || !!fileError}>
          {save.isPending ? 'Saving…' : editing ? 'Save and resubmit' : 'Submit for review'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onSaved}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function StockControl({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [delta, setDelta] = useState('');
  const adjust = useMutation({
    mutationFn: (d: number) => api.adjustStock(product.id, d),
    onSuccess: () => {
      setDelta('');
      queryClient.invalidateQueries({ queryKey: ['my-products'] });
    },
  });
  const n = Number(delta);
  return (
    <form
      className="stock-control"
      onSubmit={(e) => {
        e.preventDefault();
        if (Number.isInteger(n) && n !== 0) adjust.mutate(n);
      }}
    >
      <label>
        Restock by
        <input
          type="number"
          step={1}
          value={delta}
          placeholder="+10 or -2"
          onChange={(e) => setDelta(e.target.value)}
          aria-describedby={`stock-help-${product.id}`}
        />
      </label>
      <button className="btn btn-quiet" disabled={!delta || adjust.isPending}>
        Apply
      </button>
      <small id={`stock-help-${product.id}`} className="muted">
        Changes are relative, so they never overwrite units sold meanwhile.
      </small>
      <ErrorNote error={adjust.error} />
    </form>
  );
}

export function SellerPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const products = useQuery({ queryKey: ['my-products'], queryFn: () => api.myProducts() });
  const archive = useMutation({
    mutationFn: api.archiveProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-products'] }),
  });

  return (
    <section className="page seller">
      <div className="shelf-head">
        <h1>Your listings</h1>
        <div className="actions">
          <Link to="/sell/orders" className="btn btn-quiet">
            Orders to ship
          </Link>
          {!editing && (
            <button className="btn btn-ink" onClick={() => setEditing('new')}>
              List a product
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="panel">
          <h2>{editing === 'new' ? 'List a product' : `Edit ${editing.name}`}</h2>
          <ProductForm
            key={editing === 'new' ? 'new' : editing.id}
            product={editing === 'new' ? undefined : editing}
            onSaved={() => setEditing(null)}
          />
        </div>
      )}

      <ErrorNote error={products.error ?? archive.error} />
      {products.data?.items.length === 0 && !editing && (
        <EmptyState title="You have no listings yet">
          <button className="btn btn-ink" onClick={() => setEditing('new')}>
            List your first product
          </button>
        </EmptyState>
      )}
      <ul className="listing-list">
        {products.data?.items.map((p) => (
          <li key={p.id} className={`listing status-${p.status.toLowerCase()}`}>
            <ProductArt src={p.images[0]} name={p.name} category={p.category} />
            <div>
              <h3>
                <Link to={`/products/${p.id}`}>{p.name}</Link>
              </h3>
              <PriceTag cents={p.priceCents} size="sm" />
              <p>
                <span className="listing-status">{STATUS_COPY[p.status]}</span>, {p.stock} in stock
              </p>
              {p.status === 'REJECTED' && p.reviewNote && <p className="notice">Reviewer: {p.reviewNote}</p>}
            </div>
            {p.status !== 'ARCHIVED' && (
              <div className="listing-tools">
                <StockControl product={p} />
                <div className="actions">
                  <button className="btn btn-quiet" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                  <button
                    className="btn btn-quiet"
                    onClick={() => {
                      if (window.confirm(`Archive “${p.name}”? It will be taken off sale.`)) archive.mutate(p.id);
                    }}
                  >
                    Archive
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SellerOrdersPage() {
  return <OrderTable title="Orders to ship" queryKey="sales" load={api.sales} inlineActions />;
}
