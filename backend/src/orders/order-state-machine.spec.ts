import {
  allowedEvents,
  canTransition,
  IllegalTransitionError,
  isTerminal,
  nextStatus,
  OrderEvent,
  OrderStatus,
  releasesStock,
} from './order-state-machine';

const { PENDING_PAYMENT, PAID, SHIPPED, COMPLETED, CANCELLED } = OrderStatus;
const { PAY, CANCEL, EXPIRE, SHIP, CONFIRM } = OrderEvent;

describe('order state machine', () => {
  it.each([
    [PENDING_PAYMENT, PAY, PAID],
    [PENDING_PAYMENT, CANCEL, CANCELLED],
    [PENDING_PAYMENT, EXPIRE, CANCELLED],
    [PAID, SHIP, SHIPPED],
    [SHIPPED, CONFIRM, COMPLETED],
  ])('%s --%s--> %s', (from, event, to) => {
    expect(nextStatus(from, event)).toBe(to);
    expect(canTransition(from, event)).toBe(true);
  });

  it('walks the happy path end to end', () => {
    let status = PENDING_PAYMENT;
    for (const event of [PAY, SHIP, CONFIRM]) status = nextStatus(status, event);
    expect(status).toBe(COMPLETED);
  });

  it('rejects every transition that is not in the table', () => {
    const legal = new Set([
      `${PENDING_PAYMENT}:${PAY}`,
      `${PENDING_PAYMENT}:${CANCEL}`,
      `${PENDING_PAYMENT}:${EXPIRE}`,
      `${PAID}:${SHIP}`,
      `${SHIPPED}:${CONFIRM}`,
    ]);
    for (const from of Object.values(OrderStatus)) {
      for (const event of Object.values(OrderEvent)) {
        if (legal.has(`${from}:${event}`)) continue;
        expect(() => nextStatus(from, event)).toThrow(IllegalTransitionError);
        expect(canTransition(from, event)).toBe(false);
      }
    }
  });

  it('does not allow cancelling once paid, or paying twice', () => {
    expect(() => nextStatus(PAID, CANCEL)).toThrow('Cannot CANCEL an order that is PAID');
    expect(() => nextStatus(PAID, PAY)).toThrow(IllegalTransitionError);
    expect(() => nextStatus(CANCELLED, PAY)).toThrow(IllegalTransitionError);
  });

  it('treats COMPLETED and CANCELLED as terminal', () => {
    expect(isTerminal(COMPLETED)).toBe(true);
    expect(isTerminal(CANCELLED)).toBe(true);
    expect(isTerminal(PENDING_PAYMENT)).toBe(false);
    expect(allowedEvents(PENDING_PAYMENT).sort()).toEqual([CANCEL, EXPIRE, PAY].sort());
  });

  it('releases stock only for cancellation events', () => {
    expect(releasesStock(CANCEL)).toBe(true);
    expect(releasesStock(EXPIRE)).toBe(true);
    expect(releasesStock(PAY)).toBe(false);
    expect(releasesStock(SHIP)).toBe(false);
    expect(releasesStock(CONFIRM)).toBe(false);
  });
});
