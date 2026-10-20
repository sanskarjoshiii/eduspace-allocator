'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '@/lib/api';
import { STRATEGY_LABEL, type Strategy } from '@/lib/domain';
import { formatDateTime, formatKm, formatNumber, formatPercent, formatScore } from '@/lib/format';
import {
  Alert, Button, DataTable, Delta, EmptyState, ErrorState, KeyValueList, PageHeader, Panel, PanelGrid, Skeleton,
  SkeletonText, StatCard, StatusBadge, Timeline, type DataTableColumn, type TimelineStep,
} from '@/components/ui';
import type { MetricComparison } from '@/server/dto/run';
import { humanize } from '@/components/allocations/allocation-hooks';
import { TRIGGER_LABEL, formatDuration, runKeys, useRetryRun, type RunDetailDto } from './run-hooks';

/** Mirrors LOWER_IS_BETTER in src/server/dto/run.ts (lower values are improvements). */
const LOWER_IS_BETTER = new Set(['avgDistanceKm', 'waitlistRate', 'unmatched', 'waitlisted', 'runTimeMs']);

type Kind = 'rate' | 'km' | 'score' | 'count' | 'hours' | 'ms';
const METRICS: Record<string, { label: string; kind: Kind }> = {
  coverageRate: { label: 'Coverage', kind: 'rate' },
  avgDistanceKm: { label: 'Average distance', kind: 'km' },
  waitlistRate: { label: 'Waitlist rate', kind: 'rate' },
  seatUtilisation: { label: 'Seat utilisation', kind: 'rate' },
  avgScore: { label: 'Average compatibility score', kind: 'score' },
  optimisationScore: { label: 'Optimisation score', kind: 'score' },
  allocations: { label: 'Allocations', kind: 'count' },
  requests: { label: 'Requests', kind: 'count' },
  assigned: { label: 'Learners seated', kind: 'count' },
  waitlisted: { label: 'Waitlisted', kind: 'count' },
  unmatched: { label: 'Unmatched', kind: 'count' },
  spaceUtilisationHours: { label: 'Booked hours per week', kind: 'hours' },
  runTimeMs: { label: 'Run time', kind: 'ms' },
};
const METRIC_ORDER = Object.keys(METRICS);

function fmt(kind: Kind, v: number): string {
  switch (kind) {
    case 'rate': return formatPercent(v);
    case 'km': return formatKm(v);
    case 'score': return formatScore(v);
    case 'hours': return `${formatNumber(Math.round(v * 10) / 10)} h`;
    case 'ms': return formatDuration(v);
    default: return formatNumber(v);
  }
}

function MetricDelta({ c }: { c: MetricComparison }) {
  const kind = METRICS[c.metric]?.kind ?? 'count';
  const invert = LOWER_IS_BETTER.has(c.metric);
  if (kind === 'rate') return <Delta value={c.delta * 100} suffix=" pts" invert={invert} />;
  if (kind === 'km') return <Delta value={c.delta} suffix=" km" invert={invert} />;
  if (kind === 'score') return <Delta value={c.delta} suffix="" digits={2} invert={invert} />;
  if (kind === 'ms') return <Delta value={c.delta} suffix=" ms" digits={0} invert={invert} />;
  if (kind === 'hours') return <Delta value={c.delta} suffix=" h" invert={invert} />;
  return <Delta value={c.delta} suffix="" digits={0} invert={invert} />;
}

const COUNT_LABEL: Record<string, string> = {
  requests: 'Requests considered',
  offerings: 'Offerings considered',
  spaces: 'Spaces considered',
  newAllocations: 'New allocations',
  keptAllocations: 'Kept allocations',
  supersededAllocations: 'Replaced proposals',
  seated: 'Learners seated',
  waitlisted: 'Learners waitlisted',
  unmatched: 'Learners unmatched',
  analysed: 'Requests analysed',
  offered: 'Offers sent',
  cancelledEnrollments: 'Places released',
  droppedRejectedPairs: 'Declined pairs skipped',
  seatsConvertedToWaitlist: 'Seats moved to waitlist',
};

const PHASES = [
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'engine', label: 'Matching' },
  { key: 'publish', label: 'Publish' },
  { key: 'notify', label: 'Notify' },
];

function phaseSteps(run: RunDetailDto): TimelineStep[] {
  const done = new Set(run.partitionState.completedPhases);
  let currentAssigned = false;
  return PHASES.map((p) => {
    if (done.has(p.key) || run.status === 'Completed') return { label: p.label, state: 'done' };
    if (!currentAssigned) {
      currentAssigned = true;
      if (run.status === 'Failed') return { label: p.label, state: 'failed', description: 'Stopped here.' };
      if (run.status === 'Running') return { label: p.label, state: 'current' };
    }
    return { label: p.label, state: 'pending' };
  });
}

/** Run detail and comparison with the nearest-space baseline (PLAN 7.9). */
export function RunDetail({ id }: { id: string }) {
  const retry = useRetryRun();
  const query = useQuery({
    queryKey: runKeys.detail(id),
    queryFn: () => apiGet<RunDetailDto>(`/api/runs/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'Running' || q.state.data?.status === 'Queued' ? 10_000 : false),
  });
  const run = query.data;

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Run" description="Loading the run." />
        <PanelGrid columns={3}>
          {[0, 1, 2].map((i) => (
            <Panel key={i}>
              <StatCard label="Loading" loading />
            </Panel>
          ))}
        </PanelGrid>
        <Panel>
          <Skeleton className="mb-3 h-5 w-48" />
          <SkeletonText lines={4} />
        </Panel>
      </>
    );
  }
  if (query.isError || !run) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <PageHeader title="Run" />
        <Panel>
          {missing ? (
            <EmptyState icon="layers" description="This run does not exist." action={<Button href="/runs">Back to Runs</Button>} />
          ) : (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          )}
        </Panel>
      </>
    );
  }

  const comparison = [...run.comparison]
    .filter((c) => METRICS[c.metric])
    .sort((a, b) => METRIC_ORDER.indexOf(a.metric) - METRIC_ORDER.indexOf(b.metric));
  const byMetric = new Map(run.comparison.map((c) => [c.metric, c]));
  const headline = ['coverageRate', 'avgDistanceKm', 'waitlistRate'] as const;

  const columns: DataTableColumn<MetricComparison>[] = [
    { key: 'metric', header: 'Metric', cell: (c) => METRICS[c.metric]?.label ?? c.metric },
    { key: 'optimised', header: 'Smart Allocation', align: 'end', cell: (c) => <span className="font-mono text-data">{fmt(METRICS[c.metric]?.kind ?? 'count', c.optimised)}</span> },
    { key: 'baseline', header: 'Nearest Space', align: 'end', cell: (c) => <span className="font-mono text-data">{fmt(METRICS[c.metric]?.kind ?? 'count', c.baseline)}</span> },
    { key: 'delta', header: 'Difference', align: 'end', cell: (c) => <MetricDelta c={c} /> },
  ];

  const counts = Object.entries(run.counts ?? {}).filter(([, v]) => typeof v === 'number');

  return (
    <>
      <PageHeader
        title={`Run ${run.ref}`}
        description="What this Smart Allocation run decided and how it compares with assigning every class to its nearest space."
        meta={
          <>
            <StatusBadge status={run.status} />
            <span className="font-mono text-data text-ink-muted">{formatDateTime(run.startedAt)}</span>
          </>
        }
        actions={
          <>
            {run.status === 'Failed' ? (
              <Button icon="refresh-cw" loading={retry.isPending} onClick={() => retry.mutate(run.id)}>
                Retry Run
              </Button>
            ) : null}
            {run.status === 'Completed' ? (
              <Button variant="primary" icon="list-checks" href={`/allocations?runId=${run.id}`}>
                View Allocations
              </Button>
            ) : null}
          </>
        }
      />

      {run.status === 'Failed' && run.error ? (
        <div className="border-b border-border px-4 py-3 lg:px-6">
          <Alert tone="danger" title="This run failed">
            {run.error}
          </Alert>
        </div>
      ) : null}

      <PanelGrid columns={3}>
        {headline.map((m) => {
          const c = byMetric.get(m);
          const meta = METRICS[m]!;
          const value = run.metrics?.[m];
          return (
            <Panel key={m}>
              <StatCard
                label={meta.label}
                value={typeof value === 'number' ? fmt(meta.kind, value) : '—'}
                delta={c ? <MetricDelta c={c} /> : undefined}
                footnote={
                  c ? (
                    <>
                      Nearest-space baseline: <strong>{fmt(meta.kind, c.baseline)}</strong>.
                    </>
                  ) : (
                    'No baseline for this run.'
                  )
                }
              />
            </Panel>
          );
        })}
      </PanelGrid>

      <PanelGrid columns={2}>
        <Panel title="Comparison Report" description="Smart Allocation against the nearest-space baseline on the same data." flush>
          {comparison.length ? (
            <DataTable caption="Metrics compared with the baseline" columns={columns} rows={comparison} rowKey={(c) => c.metric} pageSize={0} />
          ) : (
            <EmptyState size="compact" icon="chart-column" description="No comparison yet. It appears once the run has published its results." />
          )}
        </Panel>
        <Panel title="Run Summary" description="Settings and outcome of this run.">
          <KeyValueList
            items={[
              { label: 'Trigger', value: TRIGGER_LABEL[run.trigger] ?? run.trigger },
              { label: 'Strategy', value: STRATEGY_LABEL[run.strategy as Strategy] ?? run.strategy },
              {
                label: 'Optimisation score',
                value: run.optimisationScore === null ? '—' : formatScore(run.optimisationScore),
                mono: true,
              },
              { label: 'Demand groups', value: run.k === null ? '—' : formatNumber(run.k), mono: true },
              { label: 'Group quality', value: run.silhouette === null ? '—' : formatScore(run.silhouette), mono: true },
              { label: 'Started', value: formatDateTime(run.startedAt), mono: true },
              { label: 'Finished', value: formatDateTime(run.finishedAt), mono: true },
              { label: 'Duration', value: formatDuration(run.durationMs), mono: true },
              { label: 'Attempts', value: formatNumber(run.attempts), mono: true },
              { label: 'Changes picked up', value: formatNumber(run.eventCount), mono: true },
            ]}
          />
          {run.retryOf ? (
            <p className="mt-3 text-body-sm text-ink-muted">
              Retry of{' '}
              <Link className="text-accent-ink underline underline-offset-2" href={`/runs/${run.retryOf}`}>
                an earlier run
              </Link>
              .
            </p>
          ) : null}
          {run.retries.length ? (
            <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
              {run.retries.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-body-sm">
                  <Link className="text-accent-ink underline underline-offset-2" href={`/runs/${r.id}`}>
                    Retry #{r.id.slice(-6).toUpperCase()}
                  </Link>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
        <Panel title="Decision Summary" description="How Smart Allocation explained this run.">
          {run.decisionSummary ? (
            <p className="m-0 text-body whitespace-pre-line text-ink">{run.decisionSummary}</p>
          ) : (
            <EmptyState size="compact" icon="scroll-text" description="No summary recorded for this run." />
          )}
        </Panel>
        <Panel title="Progress" description="Phases the run has completed.">
          <Timeline label="Run phases" steps={phaseSteps(run)} />
        </Panel>
        <Panel title="Counts" description="What the run looked at and what it changed." className="lg:col-span-2">
          {counts.length ? (
            <KeyValueList columns={2} items={counts.map(([k, v]) => ({ label: COUNT_LABEL[k] ?? humanize(k), value: formatNumber(v), mono: true }))} />
          ) : (
            <EmptyState size="compact" icon="list-checks" description="No counts recorded for this run." />
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}
