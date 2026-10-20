'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart, LineChart } from '@/components/charts';
import {
  DataTable, Delta, EmptyState, ErrorState, PageHeader, Panel, PanelGrid, Progress, SegmentBar, StatCard, StatusBadge, type DataTableColumn,
} from '@/components/ui';
import { apiGet, ApiError } from '@/lib/api';
import { DAY_SHORT, type Role } from '@/lib/domain';
import { formatDate, formatKm, formatNumber, formatPercent } from '@/lib/format';
import type {
  AdminAnalytics, AnalyticsResponse, HighDemandArea, ProviderAnalytics, SpaceGiverAnalytics, SpaceUsageRow,
} from '@/server/dto/analytics';
import { statusLabel } from '@/components/ui';

const DESCRIPTION: Record<string, string> = {
  Administrator: 'Coverage, distance, seat use and weekly trends across EduSpace.',
  SpaceGiver: 'How much of your open time is booked, by space and by weekday.',
  CourseProvider: 'Seats, learners, attendance and where demand for your courses is growing.',
};

const pct = (r: number | null | undefined) => (r === null || r === undefined ? '—' : formatPercent(r));
const hours = (h: number) => `${formatNumber(Math.round(h * 10) / 10)} h`;

/** Percentage change between the last two points of a series, or undefined when it cannot be computed. */
function lastChange(values: number[]): number | undefined {
  const last = values.at(-1);
  const prev = values.at(-2);
  if (last === undefined || prev === undefined || prev === 0) return undefined;
  return ((last - prev) / prev) * 100;
}

export function AnalyticsScreen({ role }: { role: Role }) {
  const query = useQuery({
    queryKey: ['analytics', role],
    queryFn: () => apiGet<AnalyticsResponse>('/api/analytics'),
    retry: (count, err) => !(err instanceof ApiError && err.status === 403) && count < 2,
  });

  const header = <PageHeader title="Analytics" description={DESCRIPTION[role] ?? 'Usage and outcomes for your account.'} />;

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.status === 403;
    return (
      <>
        {header}
        <PanelGrid columns={1}>
          <Panel>
            <ErrorState
              error={query.error}
              message={forbidden ? 'Analytics are available to Administrators, Space Givers and Course Providers.' : undefined}
              onRetry={forbidden ? undefined : () => query.refetch()}
            />
          </Panel>
        </PanelGrid>
      </>
    );
  }

  const data = query.data;
  return (
    <>
      {header}
      {!data ? (
        <PanelGrid columns={3}>
          {[0, 1, 2].map((i) => (
            <Panel key={i}>
              <StatCard label="Loading" loading />
            </Panel>
          ))}
        </PanelGrid>
      ) : data.scope === 'Administrator' ? (
        <AdminView data={data} />
      ) : data.scope === 'SpaceGiver' ? (
        <SpaceGiverView data={data} />
      ) : (
        <ProviderView data={data} />
      )}
    </>
  );
}

// ---- Administrator ----

function AdminView({ data }: { data: AdminAnalytics }) {
  const k = data.kpis;
  const trend = k.trend.map((w) => ({ ...w, label: formatDate(w.week).slice(0, 6) }));
  const requestDelta = lastChange(k.trend.map((w) => w.requests));
  const lastWeek = k.trend.at(-1);
  const idle = Math.max(0, k.spaceOpenHours - k.spaceUtilisationHours);
  const requestStatus = Object.entries(k.requestsByStatus)
    .filter(([, n]) => n > 0)
    .map(([status, count]) => ({ status: statusLabel(status), count }))
    .sort((a, b) => b.count - a.count);
  const allocationStatus = Object.entries(k.allocationsByStatus)
    .filter(([, n]) => n > 0)
    .map(([status, count]) => ({ status: statusLabel(status), count }))
    .sort((a, b) => b.count - a.count);
  const runs = Object.entries(k.runsByStatusLast30Days);

  return (
    <>
      <PanelGrid columns={3}>
        <Panel>
          <StatCard
            icon="inbox"
            label="Learning Requests"
            value={formatNumber(k.requestsTotal)}
            delta={requestDelta}
            footnote={lastWeek ? <><strong>{formatNumber(lastWeek.requests)}</strong> new requests in the latest week.</> : undefined}
          />
        </Panel>
        <Panel>
          <StatCard
            icon="circle-check"
            label="Coverage"
            value={pct(k.coverageRate)}
            footnote={<><strong>{formatNumber(k.unmatchedCount)}</strong> requests are still unmatched.</>}
          />
        </Panel>
        <Panel>
          <StatCard icon="map-pin" label="Average Distance" value={formatKm(k.avgDistanceKm)} footnote="Mean travel distance for learners holding a seat." />
        </Panel>
        <Panel>
          <StatCard icon="graduation-cap" label="Seat Use" title="Seats held on live classes">
            <Progress value={k.seatUtilisation * 100} label="Seat utilisation" startLabel={`${pct(k.seatUtilisation)} held`} endLabel="All seats" />
          </StatCard>
        </Panel>
        <Panel>
          <StatCard icon="list-checks" label="Waitlist Rate" value={pct(k.waitlistRate)} footnote="Requests with a learner on a waitlist." />
        </Panel>
        <Panel>
          <StatCard
            icon="triangle-alert"
            label="Facility Alerts"
            value={formatNumber(k.facilityAlertsOpen)}
            footnote={<><strong>{formatNumber(k.runsLast30Days)}</strong> Smart Allocation runs in the last 30 days.</>}
          />
        </Panel>
      </PanelGrid>

      <PanelGrid columns={2}>
        <Panel title="Weekly Trend" description="Requests, seats offered and seats filled over the last 12 weeks." icon="chart-line" className="lg:col-span-2">
          {trend.length === 0 ? (
            <EmptyState icon="chart-line" size="compact" description="No weekly data yet. Trends appear after the first week of requests." />
          ) : (
            <LineChart
              data={trend}
              xKey="label"
              series={[
                { key: 'requests', label: 'Requests' },
                { key: 'seatsOffered', label: 'Seats offered' },
                { key: 'seatsFilled', label: 'Seats filled' },
              ]}
              label={`Weekly requests, seats offered and seats filled for ${trend.length} weeks`}
              height={260}
            />
          )}
        </Panel>
        <Panel title="Space Hours" description="Weekly open hours on active spaces, booked against idle." icon="building-2">
          {k.spaceOpenHours > 0 ? (
            <div className="flex flex-col gap-4">
              <SegmentBar
                label="Weekly space hours"
                segments={[
                  { label: 'Booked', value: k.spaceUtilisationHours, tone: 'accent' },
                  { label: 'Idle', value: idle, tone: 'neutral' },
                ]}
              />
              <p className="m-0 text-body-sm text-ink-muted">
                <strong className="font-mono tabular-nums text-ink">{hours(k.spaceUtilisationHours)}</strong> booked of{' '}
                <strong className="font-mono tabular-nums text-ink">{hours(k.spaceOpenHours)}</strong> open each week.
              </p>
            </div>
          ) : (
            <EmptyState icon="building-2" size="compact" description="No open space hours yet. Spaces need unblocked weekly slots." />
          )}
        </Panel>
        <Panel title="Smart Allocation Runs" description="Runs in the last 30 days by outcome." icon="layers">
          {runs.length === 0 ? (
            <EmptyState icon="layers" size="compact" description="No runs in the last 30 days." />
          ) : (
            <div className="flex flex-wrap gap-3">
              {runs.map(([status, n]) => (
                <div key={status} className="flex items-center gap-2">
                  <StatusBadge status={status} />
                  <span className="font-mono text-data tabular-nums text-ink">{formatNumber(n)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Requests by Status" description="Where every learning request sits today." icon="inbox">
          {requestStatus.length === 0 ? (
            <EmptyState icon="inbox" size="compact" description="No learning requests yet." />
          ) : (
            <BarChart data={requestStatus} xKey="status" series={[{ key: 'count', label: 'Requests' }]} horizontal label="Learning requests by status" height={Math.max(180, requestStatus.length * 32)} showLegend={false} />
          )}
        </Panel>
        <Panel title="Allocations by Status" description="Every allocation Smart Allocation has proposed, by stage." icon="list-checks">
          {allocationStatus.length === 0 ? (
            <EmptyState icon="list-checks" size="compact" description="No allocations yet. Run Smart Allocation to propose some." />
          ) : (
            <BarChart data={allocationStatus} xKey="status" series={[{ key: 'count', label: 'Allocations' }]} horizontal label="Allocations by status" height={Math.max(180, allocationStatus.length * 32)} showLegend={false} />
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}

// ---- Space Giver ----

const spaceColumns: DataTableColumn<SpaceUsageRow>[] = [
  {
    key: 'spaceName',
    header: 'Space',
    sortable: true,
    cell: (r) => (
      <div className="flex flex-col">
        <span className="font-medium text-ink">{r.spaceName}</span>
        {!r.isActive ? <span className="text-body-sm text-ink-muted">Switched off</span> : null}
      </div>
    ),
  },
  { key: 'seatCapacity', header: 'Seats', align: 'end', sortable: true, hideBelow: 'sm', cell: (r) => formatNumber(r.seatCapacity) },
  { key: 'openHours', header: 'Open', align: 'end', sortable: true, hideBelow: 'md', cell: (r) => hours(r.openHours) },
  { key: 'bookedHours', header: 'Booked', align: 'end', sortable: true, cell: (r) => hours(r.bookedHours) },
  { key: 'unusedHours', header: 'Idle', align: 'end', sortable: true, hideBelow: 'sm', cell: (r) => hours(r.unusedHours) },
  {
    key: 'utilisation',
    header: 'Utilisation',
    sortable: true,
    width: '180px',
    cell: (r) => (
      <div className="flex items-center gap-2">
        <Progress value={r.utilisation * 100} size="sm" label={`${r.spaceName} utilisation`} className="flex-1" />
        <span className="w-12 text-right font-mono text-data tabular-nums">{pct(r.utilisation)}</span>
      </div>
    ),
  },
];

function SpaceGiverView({ data }: { data: SpaceGiverAnalytics }) {
  const byWeekday = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const row = data.byWeekday.find((w) => w.dayOfWeek === d);
    return { day: DAY_SHORT[d] ?? String(d), bookedHours: row?.bookedHours ?? 0, idleHours: Math.max(0, (row?.openHours ?? 0) - (row?.bookedHours ?? 0)) };
  });
  return (
    <>
      <PanelGrid columns={3}>
        <Panel>
          <StatCard icon="clock" label="Booked Hours" value={hours(data.totals.bookedHours)} footnote={<>of <strong>{hours(data.totals.openHours)}</strong> open each week.</>} />
        </Panel>
        <Panel>
          <StatCard icon="building-2" label="Utilisation" title="Booked share of open time">
            <Progress value={data.totals.utilisation * 100} label="Utilisation" startLabel={`${pct(data.totals.utilisation)} booked`} endLabel={`${hours(data.totals.unusedHours)} idle`} />
          </StatCard>
        </Panel>
        <Panel>
          <StatCard icon="calendar" label="Upcoming Sessions" value={formatNumber(data.upcomingSessions)} footnote={<><strong>{formatNumber(data.sessionsHeld)}</strong> sessions held so far.</>} />
        </Panel>
        <Panel>
          <StatCard icon="list-checks" label="Pending Approvals" value={formatNumber(data.pendingApprovals)} footnote="Classes waiting for you to approve." />
        </Panel>
        <Panel>
          <StatCard icon="triangle-alert" label="Open Issues" value={formatNumber(data.issuesOpen)} footnote="Facility issues still open on your spaces." />
        </Panel>
        <Panel>
          <StatCard icon="clock" label="Idle Hours" value={hours(data.totals.unusedHours)} footnote="Open time each week with no class booked." />
        </Panel>
      </PanelGrid>
      <PanelGrid columns={1}>
        <Panel title="Hours by Weekday" description="Booked and idle hours on each day of the week." icon="chart-column">
          {data.totals.openHours === 0 ? (
            <EmptyState icon="calendar" size="compact" description="No open weekly slots yet. Add slots to your spaces to start receiving classes." />
          ) : (
            <BarChart
              data={byWeekday}
              xKey="day"
              stacked
              series={[
                { key: 'bookedHours', label: 'Booked', tone: 'accent' },
                { key: 'idleHours', label: 'Idle', tone: 'neutral' },
              ]}
              valueFormatter={hours}
              label="Booked and idle hours by weekday"
            />
          )}
        </Panel>
        <Panel title="By Space" description="Weekly hours and utilisation for each of your spaces." icon="building-2">
          <DataTable
            caption="Space utilisation"
            columns={spaceColumns}
            rows={data.spaces}
            rowKey={(r) => r.spaceId}
            rowHref={(r) => `/spaces/${r.spaceId}`}
            initialSort={{ key: 'utilisation', direction: 'desc' }}
            itemLabel="spaces"
            empty={<EmptyState icon="building-2" size="compact" description="No spaces yet. Add a space to see its usage." />}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}

// ---- Course Provider ----

const demandColumns: DataTableColumn<HighDemandArea>[] = [
  { key: 'areaName', header: 'Area', sortable: true, cell: (r) => <span className="font-medium text-ink">{r.areaName}</span> },
  { key: 'categoryName', header: 'Category', sortable: true, hideBelow: 'sm' },
  { key: 'level', header: 'Level', cell: (r) => <StatusBadge status={r.level} /> },
  { key: 'demand', header: 'Demand', align: 'end', sortable: true, hideBelow: 'md', cell: (r) => formatNumber(r.demand) },
  { key: 'seatsOffered', header: 'Seats', align: 'end', sortable: true, hideBelow: 'md', cell: (r) => formatNumber(r.seatsOffered) },
  { key: 'gap', header: 'Gap', align: 'end', sortable: true, cell: (r) => <Delta value={r.gap} suffix="" digits={0} invert /> },
];

function ProviderView({ data }: { data: ProviderAnalytics }) {
  const offerings = Object.entries(data.offeringsByStatus)
    .filter(([, n]) => n > 0)
    .map(([status, count]) => ({ status: statusLabel(status), count }));
  return (
    <>
      <PanelGrid columns={3}>
        <Panel>
          <StatCard icon="graduation-cap" label="Seats Filled" title="Across your live classes">
            <Progress
              value={data.seatsFilled}
              max={Math.max(1, data.seatsOffered)}
              label="Seats filled"
              startLabel={`${formatNumber(data.seatsFilled)} seats filled`}
              endLabel={`${formatNumber(data.seatsOffered)} seats`}
            />
          </StatCard>
        </Panel>
        <Panel>
          <StatCard icon="users" label="Accepted Learners" value={formatNumber(data.acceptedLearners)} footnote="Learners who accepted a seat in your classes." />
        </Panel>
        <Panel>
          <StatCard icon="circle-check" label="Attendance" value={pct(data.attendanceRate)} footnote={data.attendanceRate === null ? 'Shows once you mark attendance.' : 'Present out of all marked attendance.'} />
        </Panel>
        <Panel>
          <StatCard
            icon="star"
            label="Average Rating"
            value={data.averageRating === null ? '—' : data.averageRating.toFixed(1)}
            footnote={<>From <strong>{formatNumber(data.ratingsCount)}</strong> learner ratings, out of 5.</>}
          />
        </Panel>
        <Panel title="Offerings by Status" description="Your class offerings at each stage." icon="book-open" className="md:col-span-2 xl:col-span-2">
          {offerings.length === 0 ? (
            <EmptyState icon="book-open" size="compact" description="No offerings yet. Create one so Smart Allocation can find it a space." />
          ) : (
            <BarChart data={offerings} xKey="status" series={[{ key: 'count', label: 'Offerings' }]} label="Offerings by status" height={200} showLegend={false} />
          )}
        </Panel>
      </PanelGrid>
      <PanelGrid columns={1}>
        <Panel title="Where Demand Is Growing" description="High and Medium demand areas for your course categories, largest gap first." icon="chart-line">
          <DataTable
            caption="High-demand areas"
            columns={demandColumns}
            rows={data.highDemandAreas}
            rowKey={(r) => `${r.areaId}-${r.categoryId}`}
            initialSort={{ key: 'gap', direction: 'desc' }}
            itemLabel="areas"
            empty={<EmptyState icon="chart-line" size="compact" description="No high-demand areas for your categories right now." />}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
