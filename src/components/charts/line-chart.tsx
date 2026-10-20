'use client';

import type { ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/components/ui/cn';
import { Skeleton } from '@/components/ui/skeleton';
import { SERIES_ORDER, type FillTone } from '@/components/ui/tone';
import { useThemeColors } from '@/hooks/use-css-colors';
import { axisTick, CHART_WRAPPER, ChartLegend, ChartTooltip, defaultFormatter, toneColor, type ChartSeries, type ValueFormatter } from './chart-parts';

export interface LineChartProps<T extends object> {
  data: readonly T[];
  /** Key for the x axis (e.g. "week" or a formatted date). */
  xKey: keyof T & string;
  /** One series draws info stroke + info-tint area; several use the series order without areas. */
  series: readonly ChartSeries[];
  height?: number;
  /** Formats values in the y axis and tooltip. */
  valueFormatter?: ValueFormatter;
  /** Formats x labels in the axis and tooltip. */
  xFormatter?: (value: string | number) => string;
  /** Index from which the range is in the future; that part is greyed out. */
  futureFromIndex?: number;
  /** Accessible summary of what the chart shows. Required. */
  label: string;
  loading?: boolean;
  showLegend?: boolean;
  className?: string;
  /** Rendered under the chart (e.g. a footnote). */
  footer?: ReactNode;
}

/** Trend line: 2px info stroke, info-tint area, faint grid, dashed cursor, inner-card tooltip. */
export function LineChart<T extends object>({
  data, xKey, series, height = 240, valueFormatter = defaultFormatter, xFormatter, futureFromIndex, label, loading, showLegend, className, footer,
}: LineChartProps<T>) {
  const { colors, ready } = useThemeColors();
  const single = series.length === 1;
  const tones: FillTone[] = series.map((s, i) => s.tone ?? (single ? 'info' : (SERIES_ORDER[i] ?? 'neutral')));
  const future = futureFromIndex !== undefined ? data[futureFromIndex] : undefined;
  const last = data[data.length - 1];

  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-3', className)}>
      <div role="img" aria-label={label} className={CHART_WRAPPER} style={{ height }}>
        {loading || !ready ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data as unknown as Record<string, unknown>[]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={colors.border} />
              <XAxis
                dataKey={xKey as string}
                tick={axisTick(colors)}
                tickLine={false}
                axisLine={{ stroke: colors.border }}
                tickFormatter={xFormatter}
                minTickGap={16}
              />
              <YAxis tick={axisTick(colors)} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => valueFormatter(v)} allowDecimals={false} />
              {future && last ? (
                <ReferenceArea
                  x1={(future as Record<string, string | number>)[xKey]}
                  x2={(last as Record<string, string | number>)[xKey]}
                  fill={colors['surface-tint']}
                  fillOpacity={0.6}
                  ifOverflow="extendDomain"
                />
              ) : null}
              <Tooltip
                cursor={{ stroke: colors['border-strong'], strokeDasharray: '4 4' }}
                content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} valueFormat={valueFormatter} labelFormat={xFormatter} />}
              />
              {series.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={toneColor(tones[i]!, colors)}
                  strokeWidth={2}
                  fill={single ? colors['info-tint'] : 'transparent'}
                  fillOpacity={1}
                  dot={false}
                  activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {showLegend ?? !single ? <ChartLegend series={series.map((s, i) => ({ label: s.label, tone: tones[i]! }))} /> : null}
      {footer ? <figcaption className="text-body-sm text-ink-muted [&_strong]:font-medium [&_strong]:text-ink">{footer}</figcaption> : null}
    </figure>
  );
}
