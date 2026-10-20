import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';

export type Handler = (url: URL, init: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> };

/** Replaces fetch with a router over `handlers` keyed by "METHOD /api/path". Records calls. */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: Array<{ key: string; init: RequestInit; url: URL }> = [];
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const key = `${init.method ?? 'GET'} ${url.pathname}`;
    calls.push({ key, init, url });
    const handler = handlers[key];
    if (!handler) return new Response(JSON.stringify({ message: `No mock for ${key}` }), { status: 404 });
    const { status = 200, body, headers = {} } = handler(url, init);
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function renderAt(path: string, routes: Array<{ path: string; element: ReactElement }>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            {routes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}
