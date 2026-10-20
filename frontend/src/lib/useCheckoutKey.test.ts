import { renderHook } from '@testing-library/react';
import { useCheckoutKey } from './useCheckoutKey';

describe('useCheckoutKey', () => {
  it('reuses one key while the cart is unchanged (double click, retry)', () => {
    const { result } = renderHook(() => useCheckoutKey('1x2,5x1'));
    const first = result.current.keyFor();
    expect(result.current.keyFor()).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('issues a new key when the cart changes', () => {
    const { result, rerender } = renderHook(({ fp }) => useCheckoutKey(fp), {
      initialProps: { fp: '1x2' },
    });
    const first = result.current.keyFor();
    rerender({ fp: '1x3' });
    expect(result.current.keyFor()).not.toBe(first);
  });

  it('issues a new key after reset (order placed)', () => {
    const { result } = renderHook(() => useCheckoutKey('1x2'));
    const first = result.current.keyFor();
    result.current.reset();
    expect(result.current.keyFor()).not.toBe(first);
  });
});
