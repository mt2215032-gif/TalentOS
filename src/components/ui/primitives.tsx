import type { ReactNode } from 'react';

/**
 * Shared UI primitives.
 *
 * Presentational only — no data fetching, no business rules. Score thresholds
 * live in `scoreBand` so every surface bands a score the same way.
 */

// ── Card ───────────────────────────────────────────────────────────────────

export function Card({
  children,
  className = '',
  padded = true,
  raised = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  raised?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-[var(--border)] ${
        raised ? 'bg-[var(--surface-raised)] shadow-[var(--shadow-md)]' : 'bg-[var(--surface)] shadow-[var(--shadow-sm)]'
      } ${padded ? 'p-5 sm:p-6' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">{title}</h2>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ── Button ─────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:hover:bg-[var(--accent)] shadow-[var(--shadow-sm)]',
  secondary:
    'border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)]',
  ghost: 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
  danger: 'border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--danger)] hover:bg-[var(--danger-soft)]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return `inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${extra}`;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  loading = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={buttonClass(variant, size, className)}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-text)] border-[var(--accent-border)]',
  success: 'bg-[var(--success-soft)] text-[var(--success)] border-transparent',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)] border-transparent',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)] border-transparent',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ── Score presentation ─────────────────────────────────────────────────────

/**
 * One place that decides what a score "means".
 *
 * Used by every score display so a 68 never reads as good on one screen and
 * poor on another.
 */
export function scoreBand(score: number): { tone: BadgeTone; label: string; color: string } {
  // `color` is the chart-mark token, which is validated for colour-vision
  // separation; `tone` drives the badge, whose text uses the text-safe token.
  // A band is always rendered with its label and score, so the colour never
  // carries the meaning on its own.
  if (score >= 80) return { tone: 'success', label: 'Strong', color: 'var(--viz-good)' };
  if (score >= 65) return { tone: 'accent', label: 'Solid', color: 'var(--viz-accent)' };
  if (score >= 45) return { tone: 'warning', label: 'Developing', color: 'var(--viz-warn)' };
  return { tone: 'danger', label: 'Needs work', color: 'var(--viz-bad)' };
}

export function ScorePill({ score, className = '' }: { score: number; className?: string }) {
  const band = scoreBand(score);
  return (
    <Badge tone={band.tone} className={className}>
      {score}
      <span className="opacity-60">/100</span>
    </Badge>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Positive renders green, negative red, zero neutral. */
  trend?: number | null;
}) {
  return (
    <Card className="flex flex-col justify-between">
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-subtle)]">
        {label}
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[26px] font-semibold leading-none tracking-tight text-[var(--text)]">
          {value}
        </span>
        {trend !== undefined && trend !== null && trend !== 0 ? (
          <span
            className="text-[13px] font-medium"
            style={{ color: trend > 0 ? 'var(--success)' : 'var(--danger)' }}
          >
            {trend > 0 ? '+' : ''}
            {trend}
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1.5 text-[12px] text-[var(--text-subtle)]">{hint}</p> : null}
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-[var(--text-subtle)]">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--text-muted)]">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Inline error, styled to sit under a form field or at the top of a form. */
export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-control)] border border-transparent bg-[var(--danger-soft)] px-3 py-2 text-[13px] leading-relaxed text-[var(--danger)]"
    >
      {children}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-[var(--text)]">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-[12px] text-[var(--text-subtle)]">{hint}</p> : null}
      {error ? (
        <p className="text-[12px] font-medium text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  'w-full rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] transition focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] disabled:opacity-60';

export function ProgressBar({
  value,
  max = 100,
  color,
  className = '',
}: {
  value: number;
  max?: number;
  color?: string;
  className?: string;
}) {
  const pct = max === 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)] ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: color ?? 'var(--accent)' }}
      />
    </div>
  );
}
