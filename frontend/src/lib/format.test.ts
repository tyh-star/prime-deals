import { formatMoney, formatRemaining, priceParts, shortId } from './format';

describe('format helpers', () => {
  it('splits a price for the shelf tag', () => {
    expect(priceParts(1999)).toEqual({ major: '19', minor: '99' });
    expect(priceParts(5)).toEqual({ major: '0', minor: '05' });
    expect(priceParts(123456700)).toEqual({ major: '1,234,567', minor: '00' });
  });

  it('formats money in CAD', () => {
    expect(formatMoney(1250)).toMatch(/12\.50/);
  });

  it('formats a countdown', () => {
    expect(formatRemaining(15 * 60_000)).toBe('15:00');
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(400)).toBe('0:01');
    expect(formatRemaining(-5)).toBe('0:00');
  });

  it('shortens order ids', () => {
    expect(shortId('3f2a9c1e-aaaa-bbbb-cccc-dddddddddddd')).toBe('3F2A9C1E');
  });
});
