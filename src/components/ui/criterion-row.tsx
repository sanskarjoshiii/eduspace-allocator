import type { ReactNode } from 'react';
import { formatScore } from '@/lib/format';
import { Badge } from './badge';
import { cn } from './cn';
import { Icon } from './icon';
import { TONE_FILL, TONE_TINT } from './tone';

export type CriterionStatus = 'pass' | 'partial' | 'fail';

const MARKS = {
  pass: { icon: 'check', tone: 'success', word: 'Passed' },
  partial: { icon: 'minus', tone: 'warning', word: 'Partly met' },
  fail: { icon: 'x', tone: 'danger', word: 'Failed' },
} as const;

export interface CriterionRowProps {
  /** The check, e.g. "Distance", "Capacity", "Accessibility". */
  name: string;
  status?: CriterionStatus;
  /** The facts with units, both sides: "2.4 km from the cohort centre, limit 5 km". */
  detail?: ReactNode;
  /** Sub-score in [0, 1]; omit for a hard constraint. */
  score?: number | null;
  /** Marks the first failed hard constraint of a rejected alternative. */
  firstFailure?: boolean;
  className?: string;
}

/** One check behind an allocation: outcome, facts and sub-score. Rows divide with dashed rules. */
export function CriterionRow({ name, status = 'pass', detail, score, firstFailure = false, className }: CriterionRowProps) {
  const m = MARKS[status];
  return (
    <div
      className={cn(
        'grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 border-b border-dashed border-border-strong py-3 font-sans text-ink last:border-b-0',
        className,
      )}
    >
      <span className={cn('grid size-6 place-items-center rounded-sm', TONE_TINT[m.tone])} title={m.word}>
        <Icon name={m.icon} size={14} strokeWidth={2} />
        <span className="sr-only">{m.word}</span>
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2 text-body leading-6 font-medium">
          {name}
          {firstFailure ? <Badge tone="danger">First failed check</Badge> : null}
        </div>
        {detail ? <div className="text-body-sm text-ink-muted">{detail}</div> : null}
      </div>
      {score === undefined || score === null ? (
        <span className="font-mono text-data leading-6 text-ink-subtle" aria-label="Hard constraint, no sub-score">
          —
        </span>
      ) : (
        <span className="font-mono text-data leading-6 text-ink tabular-nums">{formatScore(score)}</span>
      )}
    </div>
  );
}

export interface ScoreBarProps {
  /** Compatibility score in [0, 1]. Shown with two decimals; never as a percent or probability. */
  score: number;
  /** Visible label; default "Compatibility score". */
  label?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/** Compatibility score as two decimals plus a small bar. */
export function ScoreBar({ score, label = 'Compatibility score', showLabel = true, size = 'md', className }: ScoreBarProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0));
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {showLabel ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-label text-ink-muted uppercase">{label}</span>
          <span className={cn('font-mono text-ink tabular-nums', size === 'md' ? 'text-heading' : 'text-data')}>{formatScore(v)}</span>
        </div>
      ) : null}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(v.toFixed(2))}
        aria-valuetext={`${label} ${formatScore(v)}`}
        className={cn('flex', size === 'sm' ? 'h-1.5 gap-0.5' : 'h-2 gap-0.75')}
      >
        {v > 0 ? <div className={cn('flex-none rounded-pill shadow-gloss', TONE_FILL.accent)} style={{ width: v >= 1 ? '100%' : `calc(${v * 100}% - 2px)` }} /> : null}
        {v < 1 ? <div className="min-w-1 flex-1 rounded-pill bg-surface-tint shadow-[inset_0_0_0_1px_var(--border)]" /> : null}
      </div>
    </div>
  );
}
