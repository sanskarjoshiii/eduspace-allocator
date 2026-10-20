'use client';

import type { ReactNode } from 'react';
import { Bar, BarChart as RBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/components/ui/cn';
import { Skeleton } from '@/components/ui/skeleton';
import { SERIES_ORDER, type FillTone } from '@/components/ui/tone';
import { useThemeColors } from '@/hooks/use-css-colors';
import { axisTick, CHART_WRAPPER, ChartLegend, ChartTooltip, defaultFormatter, toneColor, type ChartSeries, type ValueFormatter } from './chart-parts';

export interface BarChartProps<T extends object> {
  data: readonly T[];
  /** Category key (x axis, or y axis when horizontal). */
  xKey: keyof T & string;
  /** Series in order accent, success, info, sky (override with `tone`). */
  series: readonly ChartSeries[];
  height?: number;
  stacked?: boolean;
  /** Bars run left to right with categories on the y axis (long labels). */
  horizontal?: boolean;
  valueFormatter?: ValueFormatter;
  /** Accessible summary. Required. */
  label: string;
  loading?: boolean;
  showLegend?: boolean;
  className?: string;
  footer?: ReactNode;
}

/** Bars in the design-system series order with a faint grid and inner-card tooltip. */
export function BarChart<T extends object>({
  data, xKey, series, height = 240, stacked, horizontal, valueFormatter = defaultFormatter, label, loading, showLegend, className, footer,
}: BarChartProps<T>) {
  const { colors, ready } = useThemeColors();
  const tones: FillTone[] = series.map((s, i) => s.tone ?? SERIES_ORDER[i] ?? 'neutral');
  const radius: [number, number, number, number] = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];

  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-3', className)}>
      <div role="img" aria-label={label} className={CHART_WRAPPER} style={{ height }}>
        {loading || !ready ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RBarChart data={data as unknown as Record<string, unknown>[]} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="24%">
              <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke={colors.border} />
              {horizontal ? (
                <>
                  <XAxis type="number" tick={axisTick(colors)} tickLine={false} axisLine={false} tickFormatter={(v: number) => valueFormatter(v)} allowDecimals={false} />
                  <YAxis type="category" dataKey={xKey as string} tick={axisTick(colors)} tickLine={false} axisLine={{ stroke: colors.border }} width={112} />
                </>
              ) : (
                <>
                  <XAxis dataKey={xKey as string} tick={axisTick(colors)} tickLine={false} axisLine={{ stroke: colors.border }} minTickGap={8} />
                  <YAxis tick={axisTick(colors)} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => valueFormatter(v)} allowDecimals={false} />
                </>
              )}
              <Tooltip cursor={{ fill: colors['surface-tint'], fillOpacity: 0.6 }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} valueFormat={valueFormatter} />} />
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={toneColor(tones[i]!, colors)}
                  stackId={stacked ? 'stack' : undefined}
                  radius={stacked && i < series.length - 1 ? 0 : radius}
                  maxBarSize={36}
                  isAnimationActive={false}
                />
              ))}
            </RBarChart>
          </ResponsiveContainer>
        )}
      </div>
      {showLegend ?? series.length > 1 ? <ChartLegend series={series.map((s, i) => ({ label: s.label, tone: tones[i]! }))} /> : null}
      {footer ? <figcaption className="text-body-sm text-ink-muted [&_strong]:font-medium [&_strong]:text-ink">{footer}</figcaption> : null}
    </figure>
  );
}
