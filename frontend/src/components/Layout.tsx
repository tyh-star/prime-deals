import { useQuery } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';

function SearchBox() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') ?? '');

  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/');
  };

  return (
    <form className="search" role="search" onSubmit={submit}>
      <label htmlFor="site-search" className="visually-hidden">
        Search products
      </label>
      <input
        id="site-search"
        type="search"
        placeholder="Search products or categories"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button type="submit" className="btn btn-ink">
        Search
      </button>
    </form>
  );
}

export function Layout() {
  const { user, hasRole, signOut } = useAuth();
  const navigate = useNavigate();
  const cart = useQuery({ queryKey: ['cart'], queryFn: api.cart, enabled: !!user });
  const cartCount = cart.data?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="masthead">
        <div className="masthead-inner">
          <Link to="/" className="wordmark" aria-label="Prime Deals home">
            Prime Deals
          </Link>
          <SearchBox />
          <nav className="nav" aria-label="Main">
            {user ? (
              <>
                <NavLink to="/orders">Orders</NavLink>
                {hasRole('SELLER') && <NavLink to="/sell">Sell</NavLink>}
                {hasRole('ADMIN') && <NavLink to="/admin">Review</NavLink>}
                <NavLink to="/cart" className="cart-link">
                  Cart
                  {cartCount > 0 && (
                    <span className="badge" aria-label={`${cartCount} items`}>
                      {cartCount}
                    </span>
                  )}
                </NavLink>
                <button
                  className="link-button"
                  onClick={async () => {
                    await signOut();
                    navigate('/');
                  }}
                  title={`Signed in as ${user.username}`}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <NavLink to="/register" className="btn btn-tag">
                  Create account
                </NavLink>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="footer">
        <p>Prime Deals — prices in CAD. Payments on this site are simulated.</p>
      </footer>
    </>
  );
}
