import type { ReactNode } from 'react';
import { cn } from './cn';
import { Delta } from './delta';
import { renderIcon, type IconInput } from './icon';
import { Skeleton } from './skeleton';

export interface StatCardProps {
  icon?: IconInput;
  /** Mono uppercase eyebrow, e.g. "Open Requests". */
  label: string;
  /** Usually an IconButton. */
  action?: ReactNode;
  title?: ReactNode;
  /** The one hero figure. Format it first (formatNumber / formatInr). */
  value?: ReactNode;
  /** A number renders a Delta; a node renders as given. */
  delta?: number | ReactNode;
  /** Comparison sentence with the number in <strong>. */
  footnote?: ReactNode;
  /** `xl` uses figure-xl for a single hero KPI. */
  size?: 'lg' | 'xl';
  /** Shows skeleton blocks in place of the figure and footnote. */
  loading?: boolean;
  className?: string;
  /** Pass children instead of value to use the tray for grouped content. */
  children?: ReactNode;
}

/** The signature tray: sunken shell with a mono eyebrow wrapping a white inner card. */
export function StatCard({ icon, label, action, title, value, delta, footnote, size = 'lg', loading, className, children }: StatCardProps) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-border bg-surface-sunken px-1 pb-1 text-ink', className)} aria-busy={loading || undefined}>
      <header className="flex min-h-10 items-center gap-2 pr-1.5 pl-2.5 text-ink-muted">
        {renderIcon(icon, 16)}
        <h3 className="min-w-0 flex-1 truncate font-mono text-label text-ink-muted uppercase">{label}</h3>
        {action ?? null}
      </header>
      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-4 shadow-xs">
        {title ? <div className="text-body text-ink">{title}</div> : null}
        {loading ? (
          <>
            <Skeleton className={cn(size === 'xl' ? 'h-10' : 'h-7.5', 'w-24')} />
            <Skeleton className="h-3.5 w-40" />
          </>
        ) : (
          <>
            {value !== undefined && value !== null ? (
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className={cn(size === 'xl' ? 'text-figure-xl' : 'text-figure-lg', 'tabular-nums')}>{value}</span>
                {delta === undefined || delta === null ? null : typeof delta === 'number' ? <Delta value={delta} /> : delta}
              </div>
            ) : null}
            {footnote ? <div className="text-body-sm text-ink-muted [&_strong]:font-medium [&_strong]:text-ink">{footnote}</div> : null}
          </>
        )}
        {children}
      </div>
    </section>
  );
}
