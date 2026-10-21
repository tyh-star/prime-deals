/** True in the static demo build (`VITE_DEMO=true`), where the API runs in the browser. */
export const IS_DEMO = import.meta.env.VITE_DEMO === 'true';

export const PAYMENT_WINDOW_LABEL = IS_DEMO ? '3 minutes' : '15 minutes';

export const DEMO_ACCOUNTS = [
  { role: 'Buyer', username: 'demo-buyer', password: 'demo-buyer-pass' },
  { role: 'Seller', username: 'demo-seller', password: 'demo-seller-pass' },
  { role: 'Admin', username: 'admin', password: 'admin12345' },
] as const;
