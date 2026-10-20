import type { ReactNode } from 'react';
import { cn } from './cn';
import { TONE_FILL, type FillTone } from './tone';

export interface ProgressProps {
  value: number;
  max?: number;
  tone?: FillTone;
  /** `sm` (8px) inside table cells; `md` (20px) elsewhere. */
  size?: 'sm' | 'md';
  /** Current amount, e.g. "18 seats filled". */
  startLabel?: ReactNode;
  /** Capacity, e.g. "24 seats". */
  endLabel?: ReactNode;
  /** Accessible name for the bar. Required. */
  label: string;
  className?: string;
}

/** How much of one capacity is used: a glossy filled pill and a separate remainder pill. */
export function Progress({ value, max = 100, tone = 'accent', size = 'md', startLabel, endLabel, label, className }: ProgressProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (Number(value) / max) * 100)) : 0;
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {startLabel || endLabel ? (
        <div className="flex justify-between gap-3 font-mono text-data text-ink tabular-nums">
          <span>{startLabel}</span>
          <span className="text-ink-muted">{endLabel}</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={cn('flex', size === 'sm' ? 'h-2 gap-0.75' : 'h-5 gap-1')}
      >
        {pct > 0 ? (
          <div
            className={cn('flex-none rounded-pill shadow-gloss transition-[width] duration-300 ease-out', TONE_FILL[tone])}
            style={{ width: pct >= 100 ? '100%' : `calc(${pct}% - 2px)` }}
          />
        ) : null}
        {pct < 100 ? <div className="min-w-2 flex-1 rounded-pill bg-surface-tint shadow-[inset_0_0_0_1px_var(--border)]" /> : null}
      </div>
    </div>
  );
}

export interface Segment {
  label: string;
  value: number;
  tone?: FillTone;
}

export interface SegmentBarProps {
  /** In chart order: accent, success, info, sky, then neutral for the remainder. Five or fewer. */
  segments: Segment[];
  /** Accessible summary; defaults to "label NN%, ...". */
  label?: string;
  showLegend?: boolean;
  /** Bar height: `md` 20px, `sm` 8px. */
  size?: 'sm' | 'md';
  className?: string;
}

/** Splits one whole into parts with a legend of percentages. */
export function SegmentBar({ segments, label, showLegend = true, size = 'md', className }: SegmentBarProps) {
  const list = segments.filter((s) => Number(s.value) > 0);
  const total = list.reduce((sum, s) => sum + Number(s.value), 0) || 1;
  const pct = (v: number) => (v / total) * 100;
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div
        role="img"
        aria-label={label ?? list.map((s) => `${s.label} ${Math.round(pct(s.value))}%`).join(', ')}
        className={cn('flex', size === 'sm' ? 'h-2 gap-0.75' : 'h-5 gap-1')}
      >
        {list.length === 0 ? <div className="flex-1 rounded-pill bg-surface-tint shadow-[inset_0_0_0_1px_var(--border)]" /> : null}
        {list.map((s, i) => (
          <div key={`${s.label}-${i}`} className={cn('min-w-1.5 basis-0 rounded-pill shadow-gloss', TONE_FILL[s.tone ?? 'neutral'])} style={{ flexGrow: s.value }} />
        ))}
      </div>
      {showLegend && list.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 font-mono text-delta text-ink-muted">
          {list.map((s, i) => (
            <li key={`${s.label}-${i}`} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn('size-2 rounded-pill', TONE_FILL[s.tone ?? 'neutral'])} />
              {s.label}
              <strong className="font-medium text-ink tabular-nums">{pct(s.value).toFixed(1)}%</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
