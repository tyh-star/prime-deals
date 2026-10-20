const PRICE_PATTERN = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/**
 * Parses a decimal price string such as "19.9" into integer cents (1990) using
 * string arithmetic, so no floating-point rounding is ever involved.
 * Returns null for malformed input or a non-positive price.
 */
export function parsePriceToCents(input: string): number | null {
  const match = PRICE_PATTERN.exec(input.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
