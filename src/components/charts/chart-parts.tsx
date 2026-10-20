'use client';

import type { ReactNode } from 'react';
import type { TooltipContentProps } from 'recharts';
import { cn } from '@/components/ui/cn';
import { TONE_FILL, type FillTone } from '@/components/ui/tone';
import type { ThemeColors } from '@/hooks/use-css-colors';
import { formatNumber } from '@/lib/format';

export interface ChartSeries {
  /** Data key in each row. */
  key: string;
  /** Legend and tooltip name. */
  label: string;
  /** Fill tone; defaults to the design-system series order. */
  tone?: FillTone;
}

export type ValueFormatter = (value: number) => string;
export const defaultFormatter: ValueFormatter = (v) => formatNumber(v);

export function toneColor(tone: FillTone, c: ThemeColors): string {
  return tone === 'neutral' ? c['border-strong'] : c[tone];
}

/** Tooltip styled as an inner card: mono label, dot + name + tabular value per series. */
export function ChartTooltip({
  active, payload, label, valueFormat = defaultFormatter, labelFormat,
}: Pick<Partial<TooltipContentProps<number, string>>, 'active' | 'payload' | 'label'> & { valueFormat?: ValueFormatter; labelFormat?: (label: string | number) => ReactNode }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="min-w-36 rounded-lg border border-border bg-surface px-3 py-2 text-ink shadow-sm">
      {label !== undefined ? (
        <div className="mb-1 font-mono text-delta text-ink-muted">{labelFormat ? labelFormat(label) : String(label)}</div>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {payload.map((p, i) => (
          <li key={`${String(p.dataKey)}-${i}`} className="flex items-center gap-2 text-body-sm">
            <span aria-hidden className="size-2 flex-none rounded-pill" style={{ background: p.color ?? (p.payload as { fill?: string } | undefined)?.fill }} />
            <span className="flex-1 text-ink-muted">{p.name}</span>
            <span className="font-medium tabular-nums">{typeof p.value === 'number' ? valueFormat(p.value) : String(p.value ?? '—')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dot + label legend under a chart (mono, like the segment bar legend). */
export function ChartLegend({ series, className }: { series: { label: string; tone: FillTone }[]; className?: string }) {
  return (
    <ul className={cn('m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 font-mono text-delta text-ink-muted', className)}>
      {series.map((s) => (
        <li key={s.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn('size-2 rounded-pill', TONE_FILL[s.tone])} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Axis tick text style: mono, subtle ink, tabular numerals (applied via the wrapper class too). */
export function axisTick(c: ThemeColors) {
  return { fill: c['ink-subtle'], fontSize: 12 };
}

/** Wrapper classes: mono tabular text for every SVG label. */
export const CHART_WRAPPER = 'w-full min-w-0 font-mono tabular-nums [&_.recharts-surface]:overflow-visible [&_text]:tabular-nums';
