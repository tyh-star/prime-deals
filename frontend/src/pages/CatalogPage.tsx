import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ProductQuery } from '../api/endpoints';
import type { Product } from '../api/types';
import { EmptyState, ErrorNote, Pagination, PriceTag, ProductArt } from '../components/ui';

const PAGE_SIZE = 12;
const SORTS: Array<{ value: NonNullable<ProductQuery['sort']>; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

export function ProductCard({ product }: { product: Product }) {
  const low = product.stock > 0 && product.stock <= 5;
  return (
    <li className="card">
      <Link to={`/products/${product.id}`} className="card-link">
        <ProductArt src={product.images[0]} name={product.name} category={product.category} />
        <div className="card-body">
          <h3>{product.name}</h3>
          <PriceTag cents={product.priceCents} size="sm" />
          <p className={`stock ${product.stock === 0 ? 'out' : low ? 'low' : ''}`}>
            {product.stock === 0 ? 'Sold out' : low ? `Only ${product.stock} left` : product.category}
          </p>
        </div>
      </Link>
    </li>
  );
}

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const query: ProductQuery = {
    q: params.get('q') ?? undefined,
    category: params.get('category') ?? undefined,
    sort: (params.get('sort') as ProductQuery['sort']) ?? 'newest',
    page: Number(params.get('page') ?? 1) || 1,
    pageSize: PAGE_SIZE,
  };

  const products = useQuery({
    queryKey: ['products', query],
    queryFn: () => api.products(query),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories, staleTime: 60_000 });

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const heading = query.q ? `Results for “${query.q}”` : query.category ?? 'All deals';

  return (
    <div className="catalog">
      <aside className="aisles" aria-label="Categories">
        <h2>Aisles</h2>
        <ul>
          <li>
            <button className={!query.category ? 'active' : ''} onClick={() => update({ category: undefined })}>
              Everything
            </button>
          </li>
          {categories.data?.map((c) => (
            <li key={c}>
              <button className={query.category === c ? 'active' : ''} onClick={() => update({ category: c })}>
                {c}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="shelf" aria-labelledby="shelf-heading">
        <div className="shelf-head">
          <h1 id="shelf-heading">{heading}</h1>
          <label className="sort">
            Sort
            <select value={query.sort} onChange={(e) => update({ sort: e.target.value })}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ErrorNote error={products.error} />
        {products.data && products.data.items.length === 0 && (
          <EmptyState title="Nothing on this shelf">
            <p>Try a shorter search, or browse every aisle.</p>
            <button className="btn btn-quiet" onClick={() => setParams(new URLSearchParams())}>
              Show all products
            </button>
          </EmptyState>
        )}
        <ul className="grid" aria-busy={products.isFetching}>
          {products.data?.items.map((p) => <ProductCard key={p.id} product={p} />)}
        </ul>
        {products.data && (
          <Pagination
            page={products.data.page}
            pageSize={products.data.pageSize}
            total={products.data.total}
            onPage={(page) => update({ page: String(page) })}
          />
        )}
      </section>
    </div>
  );
}
