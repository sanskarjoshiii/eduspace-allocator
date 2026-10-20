import type { RunStatus, RunTrigger, Strategy } from '@/lib/domain';
import type { RunLean } from '@/server/worker/types';

export interface RunListItemDto {
  id: string;
  ref: string;
  trigger: RunTrigger;
  status: RunStatus;
  strategy: Strategy;
  triggeredBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  retryOf: string | null;
  attempts: number;
  /** Key metrics for the list (null until the run published). */
  coverageRate: number | null;
  avgDistanceKm: number | null;
  optimisationScore: number | null;
  allocations: number | null;
  error: string;
}

/** Lower is better for these metrics; higher is better for the rest. */
export const LOWER_IS_BETTER = new Set(['avgDistanceKm', 'waitlistRate', 'unmatched', 'waitlisted', 'runTimeMs']);

export interface MetricComparison {
  metric: string;
  optimised: number;
  baseline: number;
  /** optimised − baseline */
  delta: number;
  /** delta relative to the baseline (null when the baseline is 0). */
  deltaRatio: number | null;
  /** True when the optimised result is better on this metric. */
  better: boolean;
}

export interface RunDetailDto extends RunListItemDto {
  metrics: Record<string, number> | null;
  baselineMetrics: Record<string, number> | null;
  comparison: MetricComparison[];
  decisionSummary: string;
  counts: Record<string, number> | null;
  k: number | null;
  silhouette: number | null;
  partitionState: { phase: string; attempts: number; completedPhases: string[] };
  eventCount: number;
  retries: { id: string; status: RunStatus }[];
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const num = (m: Record<string, number> | null, k: string): number | null => (m && typeof m[k] === 'number' ? m[k]! : null);

export function toRunListItem(r: RunLean): RunListItemDto {
  return {
    id: r._id.toString(),
    ref: `#${r._id.toString().slice(-6).toUpperCase()}`,
    trigger: r.trigger,
    status: r.status,
    strategy: r.strategy,
    triggeredBy: r.triggeredBy ? r.triggeredBy.toString() : null,
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    durationMs: r.startedAt && r.finishedAt ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime() : null,
    retryOf: r.retryOf ? r.retryOf.toString() : null,
    attempts: Math.max(1, r.partitionState?.attempts ?? 1),
    coverageRate: num(r.metrics, 'coverageRate'),
    avgDistanceKm: num(r.metrics, 'avgDistanceKm'),
    optimisationScore: num(r.metrics, 'optimisationScore'),
    allocations: num(r.metrics, 'allocations'),
    error: r.error ?? '',
  };
}

export function compareMetrics(m: Record<string, number> | null, b: Record<string, number> | null): MetricComparison[] {
  if (!m || !b) return [];
  return Object.keys(m)
    .filter((k) => typeof m[k] === 'number' && typeof b[k] === 'number')
    .map((k) => {
      const optimised = m[k]!;
      const baseline = b[k]!;
      const delta = optimised - baseline;
      return {
        metric: k,
        optimised,
        baseline,
        delta,
        deltaRatio: baseline === 0 ? null : delta / Math.abs(baseline),
        better: LOWER_IS_BETTER.has(k) ? delta < 0 : delta > 0,
      };
    });
}

export function toRunDetail(r: RunLean, retries: { id: string; status: RunStatus }[]): RunDetailDto {
  return {
    ...toRunListItem(r),
    metrics: r.metrics ?? null,
    baselineMetrics: r.baselineMetrics ?? null,
    comparison: compareMetrics(r.metrics ?? null, r.baselineMetrics ?? null),
    decisionSummary: r.decisionSummary ?? '',
    counts: r.counts ?? null,
    k: r.k ?? null,
    silhouette: r.silhouette ?? null,
    partitionState: {
      phase: r.partitionState?.phase ?? 'queued',
      attempts: r.partitionState?.attempts ?? 1,
      completedPhases: r.partitionState?.completedPhases ?? [],
    },
    eventCount: (r.eventIds ?? []).length,
    retries,
  };
}
