'use client';

import Link from 'next/link';
import { OPEN_REQUEST_STATUSES, STRATEGY_LABEL, type Strategy } from '@/lib/domain';
import { formatDate, formatDateTime, formatKm, formatNumber, formatPercent, formatScore } from '@/lib/format';
import type { AdminDashboard as AdminDashboardData, UnmatchedRequestDto } from '@/server/dto/analytics';
import {
  Button, DataTable, Delta, EmptyState, KeyValueList, Panel, PanelGrid, Progress, SegmentBar, StatCard, StatusBadge,
  type DataTableColumn,
} from '@/components/ui';
import { TRIGGER_LABEL } from '@/components/runs/run-hooks';
import { DemandTable, IconLink, ListRow } from './dashboard-parts';

const unmatchedColumns: DataTableColumn<UnmatchedRequestDto>[] = [
  {
    key: 'learnerName', header: 'Learner',
    cell: (r) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-ink">{r.learnerName}</span>
        <span className="truncate text-body-sm text-ink-muted">{r.categoryName}</span>
      </div>
    ),
  },
  { key: 'areaName', header: 'Area', hideBelow: 'sm' },
  { key: 'topSuggestion', header: 'Closest Option', hideBelow: 'md', cell: (r) => <span className="text-body-sm text-ink-muted">{r.topSuggestion ?? 'No suggestion yet'}</span> },
  { key: 'createdAt', header: 'Submitted', hideBelow: 'sm', cell: (r) => <span className="font-mono text-data">{formatDate(r.createdAt)}</span> },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
];

function num(m: unknown, k: string): number | null {
  if (!m || typeof m !== 'object') return null;
  const v = (m as Record<string, unknown>)[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Administrator dashboard widgets (README 17). */
export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const { kpis, latestRun: run, utilisation, impact } = data;
  const openRequests = OPEN_REQUEST_STATUSES.reduce((n, s) => n + (kpis.requestsByStatus[s] ?? 0), 0);
  const idle = Math.max(0, utilisation.openHours - utilisation.bookedHours);
  const runCoverage = num(run?.metrics, 'coverageRate');
  const baseCoverage = num(run?.baselineMetrics, 'coverageRate');
  const runDistance = num(run?.metrics, 'avgDistanceKm');
  const baseDistance = num(run?.baselineMetrics, 'avgDistanceKm');

  return (
    <>
      <PanelGrid columns={3}>
        <Panel>
          <StatCard label="Coverage" icon="circle-check" value={formatPercent(kpis.coverageRate)} footnote={<><strong>{formatNumber(kpis.requestsTotal)}</strong> requests in total.</>} />
        </Panel>
        <Panel>
          <StatCard label="Average Distance" icon="map-pin" value={formatKm(kpis.avgDistanceKm)} footnote="From each learner's area centre to their class." />
        </Panel>
        <Panel>
          <StatCard label="Seat Utilisation" icon="users" value={formatPercent(kpis.seatUtilisation)} footnote="Seats held across classes with a space." />
        </Panel>
        <Panel>
          <StatCard label="Waitlist Rate" icon="clock" value={formatPercent(kpis.waitlistRate)} footnote="Requests waiting for a seat to free up." />
        </Panel>
        <Panel>
          <StatCard
            label="Open Requests"
            icon="inbox"
            value={formatNumber(openRequests)}
            action={<IconLink label="Open learning requests" href="/requests" />}
            footnote={<><strong>{formatNumber(kpis.unmatchedCount)}</strong> unmatched right now.</>}
          />
        </Panel>
        <Panel>
          <StatCard
            label="Facility Alerts"
            icon="triangle-alert"
            value={formatNumber(kpis.facilityAlertsOpen)}
            action={<IconLink label="Open facility issues" href="/facility-issues" />}
            footnote="Open issues that can affect booked classes."
          />
        </Panel>
      </PanelGrid>

      <PanelGrid columns={2}>
        <Panel
          title="Latest Run"
          description="The most recent Smart Allocation run against the nearest-space baseline."
          actions={run ? <Button size="sm" href={`/runs/${run.id}`} iconRight="chevron-right">View Run</Button> : undefined}
        >
          {run ? (
            <KeyValueList
              items={[
                { label: 'Status', value: <StatusBadge status={run.status} /> },
                { label: 'Trigger', value: TRIGGER_LABEL[run.trigger] ?? run.trigger },
                { label: 'Strategy', value: STRATEGY_LABEL[run.strategy as Strategy] ?? run.strategy },
                { label: 'Started', value: formatDateTime(run.startedAt), mono: true },
                {
                  label: 'Coverage',
                  value: runCoverage === null ? '—' : (
                    <span className="inline-flex items-baseline gap-2">
                      {formatPercent(runCoverage)}
                      {baseCoverage !== null ? <Delta value={(runCoverage - baseCoverage) * 100} suffix=" pts" /> : null}
                    </span>
                  ),
                  mono: true,
                },
                {
                  label: 'Average distance',
                  value: runDistance === null ? '—' : (
                    <span className="inline-flex items-baseline gap-2">
                      {formatKm(runDistance)}
                      {baseDistance !== null ? <Delta value={runDistance - baseDistance} suffix=" km" invert /> : null}
                    </span>
                  ),
                  mono: true,
                },
                { label: 'Optimisation score', value: num(run.metrics, 'optimisationScore') === null ? '—' : formatScore(num(run.metrics, 'optimisationScore')!), mono: true },
                { label: 'Allocations', value: num(run.metrics, 'allocations') === null ? '—' : formatNumber(num(run.metrics, 'allocations')!), mono: true },
                ...(run.error ? [{ label: 'Error', value: run.error }] : []),
              ]}
            />
          ) : (
            <EmptyState size="compact" icon="layers" description="No Smart Allocation run yet. Start one with Run Allocation." />
          )}
        </Panel>
        <Panel title="Utilisation" description="Weekly hours booked across all active spaces.">
          <div className="flex flex-col gap-6">
            <SegmentBar
              label="Weekly space hours"
              segments={[
                { label: 'Booked', value: utilisation.bookedHours, tone: 'accent' },
                { label: 'Idle', value: idle, tone: 'neutral' },
              ]}
            />
            <KeyValueList
              items={[
                { label: 'Booked hours per week', value: formatNumber(Math.round(utilisation.bookedHours)), mono: true },
                { label: 'Open hours per week', value: formatNumber(Math.round(utilisation.openHours)), mono: true },
                { label: 'Hours used', value: formatPercent(utilisation.ratio), mono: true },
              ]}
            />
            <Progress
              value={Math.round(utilisation.seatUtilisation * 100)}
              label="Seat utilisation"
              tone="success"
              startLabel={`${formatPercent(utilisation.seatUtilisation)} of seats held`}
              endLabel="All seats"
            />
          </div>
        </Panel>

        <Panel
          title="Unmatched Requests"
          description="The oldest requests Smart Allocation could not place yet."
          className="lg:col-span-2"
          flush
          actions={<Button size="sm" href="/requests?status=Unmatched">All Requests</Button>}
        >
          <DataTable
            caption="Unmatched requests"
            columns={unmatchedColumns}
            rows={data.unmatchedRequests}
            rowKey={(r) => r.id}
            rowHref={(r) => `/requests/${r.id}`}
            pageSize={0}
            empty={<EmptyState size="compact" icon="circle-check" description="Every open request has a place or a waitlist spot." />}
          />
        </Panel>

        <Panel title="Facility Alerts" description="Open facility issues, newest first.">
          {data.facilityAlerts.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {data.facilityAlerts.map((f) => (
                <ListRow key={f.id}>
                  <div className="flex min-w-0 flex-col">
                    <Link className="text-body text-ink underline-offset-2 hover:underline" href={`/facility-issues/${f.id}`}>
                      {f.facilityName} at {f.spaceName}
                    </Link>
                    <span className="text-body-sm text-ink-muted">
                      {formatNumber(f.affectedQuantity)} units down · {formatNumber(f.affectedAllocations)} {f.affectedAllocations === 1 ? 'class' : 'classes'} affected
                    </span>
                  </div>
                  <span className="font-mono text-data text-ink-muted">{formatDate(f.createdAt)}</span>
                </ListRow>
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" icon="circle-check" description="No open facility issues." />
          )}
        </Panel>

        <Panel title="Social Impact" description={`Headline numbers for ${impact.period}.`} actions={<Button size="sm" href="/impact">View Impact</Button>}>
          <KeyValueList
            columns={2}
            items={[
              { label: 'Learners served', value: formatNumber(impact.metrics.learnersServed), mono: true },
              { label: 'Learning hours', value: formatNumber(Math.round(impact.metrics.learningHours)), mono: true },
              { label: 'Sessions scheduled', value: formatNumber(impact.metrics.sessionsScheduled), mono: true },
              { label: 'Spaces used', value: formatNumber(impact.metrics.spacesUsed), mono: true },
              { label: 'Idle hours put to use', value: formatNumber(Math.round(impact.metrics.idleHoursUsed)), mono: true },
              { label: 'Areas reached', value: formatNumber(impact.metrics.areasReached), mono: true },
            ]}
          />
        </Panel>

        <Panel
          title="Demand by Area"
          description="Areas with the largest gap between demand and seats offered."
          className="lg:col-span-2"
          flush
          actions={<Button size="sm" href="/demand-insights">Demand Insights</Button>}
        >
          <DemandTable rows={data.demandByArea} caption="Demand by area" empty="No demand recorded yet. It appears after the first run." />
        </Panel>
      </PanelGrid>
    </>
  );
}
