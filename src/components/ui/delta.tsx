import { cn } from './cn';
import { Icon } from './icon';

export interface DeltaProps {
  /** Change against the previous period, e.g. 12.4 or -3. */
  value: number;
  /** Default "%". Use "" for counts or " km" for distances. */
  suffix?: string;
  digits?: number;
  /** Set when a decrease is good (average distance, waitlist rate). */
  invert?: boolean;
  className?: string;
}

/** Formats a delta with an explicit sign (U+2212 minus for negatives). */
export function formatDelta(value: number, digits = 1, suffix = '%'): string {
  const n = Number.isFinite(value) ? value : 0;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(digits)}${suffix}`;
}

/** Change in a figure with sign, arrow and colour. Place right after the figure. */
export function Delta({ value, suffix = '%', digits = 1, invert = false, className }: DeltaProps) {
  const n = Number.isFinite(value) ? value : 0;
  const dir = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const good = dir !== 'flat' && (dir === 'up') !== invert;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-sans text-delta tabular-nums whitespace-nowrap',
        dir === 'flat' ? 'text-ink-subtle' : good ? 'text-success-ink' : 'text-danger-ink',
        className,
      )}
    >
      {dir === 'flat' ? null : <Icon name={dir === 'up' ? 'arrow-up-right' : 'arrow-down-right'} size={12} strokeWidth={2} />}
      {formatDelta(n, digits, suffix)}
      <span className="sr-only">{dir === 'flat' ? ' no change' : good ? ' improvement' : ' decline'}</span>
    </span>
  );
}
