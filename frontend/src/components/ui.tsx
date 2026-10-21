import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import type { OrderStatus, Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatRemaining, ORDER_STATUS_LABEL, priceParts } from '../lib/format';

/** The shelf-tag price: the one loud element in the interface. */
export function PriceTag({ cents, size = 'md' }: { cents: number; size?: 'sm' | 'md' | 'lg' }) {
  const { major, minor } = priceParts(cents);
  return (
    <span className={`tag tag-${size}`} aria-label={`$${major}.${minor}`}>
      <span className="tag-currency" aria-hidden>
        $
      </span>
      <span className="tag-major" aria-hidden>
        {major}
      </span>
      <span className="tag-minor" aria-hidden>
        {minor}
      </span>
    </span>
  );
}

const ART_TONES = ['#DCE6F5', '#E4EEDC', '#F3E3DA', '#E8E1F2', '#DDEDEC', '#F2EBD3'];

function toneFor(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ART_TONES[h % ART_TONES.length];
}

/** Product image, or a typographic stand-in when the seller uploaded none. */
export function ProductArt({ src, name, category }: { src?: string | null; name: string; category?: string }) {
  if (src) return <img className="art" src={src} alt={name} loading="lazy" />;
  return (
    <div className="art art-placeholder" style={{ background: toneFor(category ?? name) }} aria-hidden>
      <span>{name.trim().charAt(0).toUpperCase()}</span>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong. Try again.';
  return (
    <p className="error-note" role="alert">
      {message}
    </p>
  );
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

export function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`pill pill-${status.toLowerCase()}`}>{ORDER_STATUS_LABEL[status]}</span>;
}

const TRACK: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'SHIPPED', 'COMPLETED'];

/** The order lifecycle is a real sequence, so it is drawn as one. */
export function OrderTrack({ status }: { status: OrderStatus }) {
  if (status === 'CANCELLED') {
    return (
      <ol className="track track-cancelled" aria-label="Order progress">
        <li className="step done">Placed</li>
        <li className="step current">Cancelled</li>
      </ol>
    );
  }
  const at = TRACK.indexOf(status);
  return (
    <ol className="track" aria-label="Order progress">
      {TRACK.map((s, i) => (
        <li
          key={s}
          className={`step ${i < at ? 'done' : ''} ${i === at ? 'current' : ''}`}
          aria-current={i === at ? 'step' : undefined}
        >
          <span className="step-num">{i + 1}</span>
          {s === 'PENDING_PAYMENT' ? 'Placed' : ORDER_STATUS_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

/** Live countdown to the payment deadline; calls `onExpire` once when it hits zero. */
export function Countdown({ until, onExpire }: { until: string; onExpire?: () => void }) {
  const deadline = new Date(until).getTime();
  const [now, setNow] = useState(() => Date.now());
  const left = deadline - now;

  useEffect(() => {
    if (left <= 0) {
      onExpire?.();
      return;
    }
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [left, onExpire]);

  if (left <= 0) return <span className="countdown expired">Payment window closed</span>;
  return (
    <span className={`countdown ${left < 60_000 ? 'urgent' : ''}`}>
      Pay within <strong>{formatRemaining(left)}</strong>
    </span>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button className="btn btn-quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button className="btn btn-quiet" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

export function QuantityStepper({
  value,
  max,
  onChange,
  disabled,
  label = 'Quantity',
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const clamp = (n: number) => Math.min(Math.max(1, n), Math.max(1, max));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" disabled={disabled || value <= 1} onClick={() => onChange(clamp(value - 1))} aria-label="One fewer">
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))} aria-label="One more">
        +
      </button>
    </div>
  );
}

/** Route guard: sends anonymous visitors to sign in and hides role-specific pages. */
export function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted pad">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <section className="page narrow">
        <h1>Not available for your account</h1>
        <p className="muted">This page is for {roles.map((r) => r.toLowerCase()).join(' or ')} accounts.</p>
      </section>
    );
  }
  return <>{children}</>;
}

/**
 * Two-step destructive action: the first click asks, the second acts.
 * Used instead of window.confirm(), which some embedded viewers block.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  disabled,
  className = 'btn btn-quiet',
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm" role="group" aria-label={question}>
      <span>{question}</span>
      <button
        type="button"
        className="btn btn-danger"
        disabled={disabled}
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>
        Keep it
      </button>
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
