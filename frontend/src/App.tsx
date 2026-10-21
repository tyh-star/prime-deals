import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from './api/client';
import { AuthProvider } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { IS_DEMO } from './lib/demo';
import { RequireRole } from './components/ui';
import { AdminPage } from './pages/AdminPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';
import { OrderDetailPage, OrdersPage } from './pages/OrderPages';
import { ProductPage } from './pages/ProductPage';
import { SellerOrdersPage, SellerPage } from './pages/SellerPage';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Client errors (404, 403…) will not fix themselves; only retry network/server failures.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CatalogPage />} />
        <Route path="products/:id" element={<ProductPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="cart" element={<RequireRole><CartPage /></RequireRole>} />
        <Route path="orders" element={<RequireRole><OrdersPage /></RequireRole>} />
        <Route path="orders/:id" element={<RequireRole><OrderDetailPage /></RequireRole>} />
        <Route path="sell" element={<RequireRole roles={['SELLER']}><SellerPage /></RequireRole>} />
        <Route path="sell/orders" element={<RequireRole roles={['SELLER']}><SellerOrdersPage /></RequireRole>} />
        <Route path="admin" element={<RequireRole roles={['ADMIN']}><AdminPage /></RequireRole>} />
        <Route
          path="*"
          element={
            <section className="page narrow">
              <h1>Page not found</h1>
            </section>
          }
        />
      </Route>
    </Routes>
  );
}

// The static demo is served from a sub-path with no server rewrites, so it uses hash URLs.
const Router = IS_DEMO ? HashRouter : BrowserRouter;

export function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Router>
          <AppRoutes />
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  );
}
