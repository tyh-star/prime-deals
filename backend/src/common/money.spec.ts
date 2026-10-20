import { formatCents, parsePriceToCents } from './money';

describe('parsePriceToCents', () => {
  it.each([
    ['19.99', 1999],
    ['19.9', 1990],
    ['19', 1900],
    ['0.01', 1],
    ['0.10', 10],
    [' 7.5 ', 750],
    ['1234567.89', 123456789],
  ])('%s → %d', (input, cents) => {
    expect(parsePriceToCents(input)).toBe(cents);
  });

  it('avoids floating point error (0.1 + 0.2 style inputs)', () => {
    expect(parsePriceToCents('0.29')).toBe(29);
    expect(parsePriceToCents('1.15')).toBe(115);
  });

  it.each(['', 'abc', '1.999', '-1', '0', '0.00', '1e3', '12345678'])('rejects %p', (input) => {
    expect(parsePriceToCents(input)).toBeNull();
  });
});

describe('formatCents', () => {
  it('formats with two decimals', () => {
    expect(formatCents(1999)).toBe('19.99');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(-250)).toBe('-2.50');
  });
});
