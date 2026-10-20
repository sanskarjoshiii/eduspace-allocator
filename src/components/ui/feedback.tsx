import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { Badge } from './badge';
import { Button } from './button';
import { cn } from './cn';
import { Icon, renderIcon, type IconInput } from './icon';
import { TONE_TINT, type Tone } from './tone';

export interface EmptyStateProps {
  icon?: IconInput;
  /** Optional short heading. */
  title?: ReactNode;
  /** One sentence: "No spaces yet. Add your first space to start receiving classes." */
  description: ReactNode;
  /** One action (usually a Button). */
  action?: ReactNode;
  /** `compact` for use inside table bodies and small panels. */
  size?: 'md' | 'compact';
  className?: string;
}

/** 40px tint square with a line icon, one sentence and one action. */
export function EmptyState({ icon = 'inbox', title, description, action, size = 'md', className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 text-center', size === 'md' ? 'px-4 py-10' : 'px-4 py-6', className)}>
      <span className="grid size-10 place-items-center rounded-md bg-surface-tint text-ink-muted">{renderIcon(icon, 18)}</span>
      <div className="flex max-w-md flex-col gap-1">
        {title ? <p className="m-0 text-heading text-ink">{title}</p> : null}
        <p className="m-0 text-body-sm text-ink-muted">{description}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Best user-facing sentence for an unknown error. */
export function errorMessage(error: unknown, fallback = 'Something went wrong while loading this. Try again in a moment.'): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session has ended. Sign in again to continue.';
    if (error.status === 403) return 'You do not have access to this.';
    if (error.status === 404) return 'We could not find what you were looking for.';
    if (error.status >= 500) return fallback;
    return error.message || fallback;
  }
  return fallback;
}

export interface ErrorStateProps {
  /** Sentence that says what to do next; derived from `error` when omitted. */
  message?: ReactNode;
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  size?: 'md' | 'compact';
  className?: string;
}

/** Danger badge + sentence + Retry. */
export function ErrorState({ message, error, onRetry, retryLabel = 'Try Again', size = 'md', className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 text-center', size === 'md' ? 'px-4 py-10' : 'px-4 py-6', className)}>
      <Badge tone="danger">Error</Badge>
      <p className="m-0 max-w-md text-body-sm text-ink-muted">{message ?? errorMessage(error)}</p>
      {onRetry ? (
        <Button size="sm" icon="refresh-cw" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export interface AlertProps {
  tone?: Exclude<Tone, 'accent'>;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

const ALERT_ICON = { neutral: 'info', info: 'info', success: 'circle-check', warning: 'triangle-alert', danger: 'circle-alert' } as const;

/** Inline message on a tinted ground (form errors, pending approval, notices). */
export function Alert({ tone = 'info', title, children, action, className }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-md px-3 py-2.5 text-body-sm', TONE_TINT[tone], className)}
    >
      <Icon name={ALERT_ICON[tone]} size={16} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="m-0 font-medium">{title}</p> : null}
        {children ? <div className="text-ink">{children}</div> : null}
      </div>
      {action ?? null}
    </div>
  );
}

export type TimelineState = 'done' | 'current' | 'pending' | 'failed';

export interface TimelineStep {
  /** Status word, e.g. "Submitted", "Matched", "Offered". */
  label: string;
  description?: ReactNode;
  /** Pre-formatted date (formatDate / formatDateTime). */
  date?: string;
  state: TimelineState;
}

const STEP_WORD: Record<TimelineState, string> = { done: 'Done', current: 'Current step', pending: 'Not yet', failed: 'Stopped' };

/** Vertical status timeline (learner request lifecycle). */
export function Timeline({ steps, className, label = 'Status timeline' }: { steps: TimelineStep[]; className?: string; label?: string }) {
  return (
    <ol aria-label={label} className={cn('m-0 flex list-none flex-col p-0', className)}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={`${s.label}-${i}`} aria-current={s.state === 'current' ? 'step' : undefined} className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
            {!last ? (
              <span
                aria-hidden
                className={cn('absolute top-6 bottom-0 left-2.75 border-l', s.state === 'done' ? 'border-success' : 'border-dashed border-border-strong')}
              />
            ) : null}
            <span
              className={cn(
                'relative z-[1] grid size-6 place-items-center rounded-pill',
                s.state === 'done' && TONE_TINT.success,
                s.state === 'failed' && TONE_TINT.danger,
                s.state === 'current' && 'bg-accent-tint',
                s.state === 'pending' && 'border border-border-strong bg-surface',
              )}
            >
              {s.state === 'done' ? <Icon name="check" size={14} strokeWidth={2} /> : null}
              {s.state === 'failed' ? <Icon name="x" size={14} strokeWidth={2} /> : null}
              {s.state === 'current' ? <span className="size-2.5 rounded-pill bg-accent" /> : null}
              <span className="sr-only">{STEP_WORD[s.state]}</span>
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className={cn('text-body', s.state === 'pending' ? 'text-ink-muted' : 'font-medium text-ink')}>{s.label}</span>
                {s.date ? <span className="font-mono text-data text-ink-subtle tabular-nums">{s.date}</span> : null}
              </div>
              {s.description ? <div className="text-body-sm text-ink-muted">{s.description}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Up to two initials from a name or email. */
export function initials(name: string | null | undefined): string {
  const src = (name ?? '').trim();
  if (!src) return '?';
  const base = src.includes('@') ? src.split('@')[0]!.replace(/[._-]+/g, ' ') : src;
  const parts = base.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase() || '?';
}

export interface UserChipProps {
  name: string;
  /** Second line, e.g. the role label. */
  meta?: ReactNode;
  /** Hide the text below sm (initials only). */
  compact?: boolean;
  className?: string;
}

/** Initials circle with name and meta. No photos. */
export function UserChip({ name, meta, compact, className }: UserChipProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <span aria-hidden className="grid size-7 flex-none place-items-center rounded-pill bg-surface-tint font-mono text-delta text-ink">
        {initials(name)}
      </span>
      <span className={cn('flex min-w-0 flex-col text-left', compact && 'max-sm:sr-only')}>
        <span className="truncate text-body-sm font-medium text-ink">{name}</span>
        {meta ? <span className="truncate font-mono text-delta text-ink-subtle">{meta}</span> : null}
      </span>
    </span>
  );
}
