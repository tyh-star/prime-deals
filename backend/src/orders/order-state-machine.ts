/**
 * Order lifecycle as an explicit, data-driven state machine.
 *
 *   PENDING_PAYMENT --PAY-----> PAID --SHIP--> SHIPPED --CONFIRM--> COMPLETED
 *         |
 *         +--CANCEL / EXPIRE--> CANCELLED   (stock is released)
 *
 * Every status change in the codebase goes through `nextStatus`, and the
 * database write is a compare-and-set on the *from* status, so two racing
 * transitions (e.g. a payment arriving while the timeout fires) can never
 * both succeed.
 */
export enum OrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  SHIPPED = 'SHIPPED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum OrderEvent {
  /** Buyer pays (simulated payment). */
  PAY = 'PAY',
  /** Buyer or admin cancels an unpaid order. */
  CANCEL = 'CANCEL',
  /** System cancels an order whose payment window elapsed. */
  EXPIRE = 'EXPIRE',
  /** Seller (or admin) hands the parcel to the carrier. */
  SHIP = 'SHIP',
  /** Buyer confirms receipt. */
  CONFIRM = 'CONFIRM',
}

const TRANSITIONS: Readonly<Record<OrderStatus, Readonly<Partial<Record<OrderEvent, OrderStatus>>>>> =
  {
    [OrderStatus.PENDING_PAYMENT]: {
      [OrderEvent.PAY]: OrderStatus.PAID,
      [OrderEvent.CANCEL]: OrderStatus.CANCELLED,
      [OrderEvent.EXPIRE]: OrderStatus.CANCELLED,
    },
    [OrderStatus.PAID]: {
      [OrderEvent.SHIP]: OrderStatus.SHIPPED,
    },
    [OrderStatus.SHIPPED]: {
      [OrderEvent.CONFIRM]: OrderStatus.COMPLETED,
    },
    [OrderStatus.COMPLETED]: {},
    [OrderStatus.CANCELLED]: {},
  };

/** Events whose transition gives reserved stock back to the catalogue. */
const STOCK_RELEASING_EVENTS: ReadonlySet<OrderEvent> = new Set([
  OrderEvent.CANCEL,
  OrderEvent.EXPIRE,
]);

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly event: OrderEvent,
  ) {
    super(`Cannot ${event} an order that is ${from}`);
    this.name = 'IllegalTransitionError';
  }
}

export function nextStatus(from: OrderStatus, event: OrderEvent): OrderStatus {
  const to = TRANSITIONS[from]?.[event];
  if (!to) throw new IllegalTransitionError(from, event);
  return to;
}

export function canTransition(from: OrderStatus, event: OrderEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}

export function allowedEvents(from: OrderStatus): OrderEvent[] {
  return Object.keys(TRANSITIONS[from] ?? {}) as OrderEvent[];
}

export function isTerminal(status: OrderStatus): boolean {
  return allowedEvents(status).length === 0;
}

export function releasesStock(event: OrderEvent): boolean {
  return STOCK_RELEASING_EVENTS.has(event);
}
