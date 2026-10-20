const BASE = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'pd.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string | null) => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable (private mode) — session-only login */
    }
  },
};

let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join('. ');
    if (typeof m === 'string') return m;
  }
  return fallback;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export async function requestRaw<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const url = new URL(`${BASE}/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { ...opts.headers };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body; // browser sets the multipart boundary
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, { method: opts.method ?? 'GET', headers, body });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    const code =
      data && typeof data === 'object' && 'code' in data ? String((data as { code: unknown }).code) : undefined;
    throw new ApiError(res.status, messageOf(data, res.statusText || 'Request failed'), code, data);
  }
  return { data: data as T, status: res.status, headers: res.headers };
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await requestRaw<T>(path, opts)).data;
}
