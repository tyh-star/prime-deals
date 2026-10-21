import { useQuery } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { IS_DEMO } from '../lib/demo';
import { ConfirmButton } from './ui';

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

function DemoBanner() {
  const reset = async () => {
    const { demoServer } = await import('../demo/demoServer');
    demoServer().reset();
    localStorage.removeItem('pd.token');
    window.location.reload();
  };
  return (
    <div className="demo-banner" role="note">
      <p>
        Demo: this copy runs entirely in your browser with sample data, and payment is simulated. Unpaid orders
        expire after 3 minutes.{' '}
        <a href="https://github.com/tyh-star/prime-deals">Source on GitHub</a>
      </p>
      <ConfirmButton
        className="link-button"
        label="Reset demo data"
        question="Remove the orders, listings and accounts you created?"
        confirmLabel="Reset"
        onConfirm={reset}
      />
    </div>
  );
}

export function Layout() {
  const { user, hasRole, signOut } = useAuth();
  const navigate = useNavigate();
  const cart = useQuery({ queryKey: ['cart'], queryFn: api.cart, enabled: !!user });
  const cartCount = cart.data?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;

  return (
    <>
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          // Move focus without touching the URL hash (the demo build routes by hash).
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      {IS_DEMO && <DemoBanner />}
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
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="footer">
        <p>Prime Deals — prices in CAD. Payments on this site are simulated.</p>
      </footer>
    </>
  );
}
