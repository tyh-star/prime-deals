import { useCallback, useRef } from 'react';

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * One Idempotency-Key per checkout attempt. The key is reused for as long as the
 * cart contents (the `fingerprint`) stay the same, so a double click or a retry
 * after a dropped connection cannot create a second order. It rotates when the
 * cart changes or after a successful order.
 */
export function useCheckoutKey(fingerprint: string) {
  const ref = useRef<{ fingerprint: string; key: string } | null>(null);

  const keyFor = useCallback(() => {
    if (!ref.current || ref.current.fingerprint !== fingerprint) {
      ref.current = { fingerprint, key: newKey() };
    }
    return ref.current.key;
  }, [fingerprint]);

  const reset = useCallback(() => {
    ref.current = null;
  }, []);

  return { keyFor, reset };
}
