'use client';

import Link from 'next/link';
import { formatNumber, formatPercent } from '@/lib/format';
import type { HighDemandArea, ProviderDashboard as ProviderDashboardData, ProviderOfferingCard } from '@/server/dto/analytics';
import { Button, DataTable, EmptyState, Panel, PanelGrid, StatCard, StatusBadge, type DataTableColumn } from '@/components/ui';
import { useAllocationAction } from '@/components/allocations/allocation-hooks';
import { IconLink, ListRow } from './dashboard-parts';

const offeringColumns: DataTableColumn<ProviderOfferingCard>[] = [
  { key: 'title', header: 'Offering' },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  {
    key: 'assigned', header: 'Assigned Space', hideBelow: 'sm',
    cell: (r) =>
      r.assigned ? (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-ink">{r.assigned.spaceName}</span>
          <span className="truncate text-body-sm text-ink-muted">{r.assigned.areaName}</span>
        </div>
      ) : (
        <span className="text-body-sm text-ink-muted">Not placed yet</span>
      ),
  },
  { key: 'session', header: 'Session', hideBelow: 'md', cell: (r) => <span className="font-mono text-data whitespace-nowrap">{r.assigned?.session ?? '—'}</span> },
  { key: 'allocationStatus', header: 'Allocation', hideBelow: 'md', cell: (r) => (r.assigned ? <StatusBadge status={r.assigned.allocationStatus} /> : '—') },
  {
    key: 'acceptedLearners', header: 'Accepted', align: 'end',
    cell: (r) => (
      <span className="tabular-nums">
        {formatNumber(r.acceptedLearners)} / {formatNumber(r.batchSize)}
      </span>
    ),
  },
];

const demandColumns: DataTableColumn<HighDemandArea>[] = [
  { key: 'areaName', header: 'Area' },
  { key: 'categoryName', header: 'Category', hideBelow: 'sm' },
  { key: 'level', header: 'Level', cell: (r) => <StatusBadge status={r.level} /> },
  { key: 'demand', header: 'Demand', align: 'end', cell: (r) => formatNumber(r.demand) },
  { key: 'seatsOffered', header: 'Seats Offered', align: 'end', hideBelow: 'sm', cell: (r) => formatNumber(r.seatsOffered) },
  { key: 'gap', header: 'Gap', align: 'end', cell: (r) => formatNumber(r.gap) },
];

/** Course Provider dashboard widgets (README 17). */
export function ProviderDashboard({ data }: { data: ProviderDashboardData }) {
  const action = useAllocationAction();
  const awaiting = data.offerings.filter((o) => o.assigned && (o.assigned.allocationStatus === 'ApprovedBySpace' || o.assigned.allocationStatus === 'Proposed'));
  const readyCount = awaiting.filter((o) => o.assigned?.allocationStatus === 'ApprovedBySpace').length;

  return (
    <>
      <PanelGrid columns={3}>
        <Panel>
          <StatCard
            label="Accepted Learners"
            icon="users"
            value={formatNumber(data.acceptedLearners)}
            action={<IconLink href="/learners" label="Open learners" />}
            footnote="Learners who accepted a seat in your classes."
          />
        </Panel>
        <Panel>
          <StatCard
            label="Attendance"
            icon="circle-check"
            value={data.attendanceRate === null ? '—' : formatPercent(data.attendanceRate)}
            footnote={data.attendanceRate === null ? 'Shown once you mark attendance.' : 'Present out of all marked sessions.'}
          />
        </Panel>
        <Panel>
          <StatCard
            label="Awaiting Confirmation"
            icon="list-checks"
            value={formatNumber(readyCount)}
            action={<IconLink href="/allocations?status=ApprovedBySpace" label="Open allocations awaiting confirmation" />}
            footnote="Approved by the space and waiting for you."
          />
        </Panel>
      </PanelGrid>

      <PanelGrid columns={2}>
        <Panel title="Awaiting Your Confirmation" description="Confirm to send offers to learners. You can confirm once the space approves.">
          {awaiting.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {awaiting.map((o) => {
                const a = o.assigned!;
                const ready = a.allocationStatus === 'ApprovedBySpace';
                return (
                  <ListRow key={o.offeringId} className="items-start">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Link className="text-body font-medium text-ink underline-offset-2 hover:underline" href={`/allocations/${a.allocationId}`}>
                        {o.title}
                      </Link>
                      <span className="text-body-sm text-ink-muted">
                        {a.spaceName}, {a.areaName}
                      </span>
                      <span className="font-mono text-data text-ink-muted">{a.session}</span>
                      {!ready ? <span className="text-body-sm text-ink-muted">Waiting for the space to approve.</span> : null}
                    </div>
                    {ready ? (
                      <Button
                        size="sm"
                        icon="check"
                        disabled={action.isPending}
                        loading={action.isPending && action.variables?.id === a.allocationId}
                        onClick={() => action.mutate({ id: a.allocationId, action: 'confirm' })}
                      >
                        Confirm
                      </Button>
                    ) : (
                      <StatusBadge status={a.allocationStatus} />
                    )}
                  </ListRow>
                );
              })}
            </ul>
          ) : (
            <EmptyState size="compact" icon="circle-check" description="Nothing to confirm. New placements appear here after each run." />
          )}
        </Panel>

        <Panel
          title="High-Demand Areas"
          description="Areas and categories where learners outnumber the seats on offer."
          flush
          actions={<Button size="sm" href="/demand-insights">Demand Insights</Button>}
        >
          <DataTable
            caption="High-demand areas"
            columns={demandColumns}
            rows={data.highDemandAreas}
            rowKey={(r) => `${r.areaId}-${r.categoryId}`}
            pageSize={0}
            empty={<EmptyState size="compact" icon="chart-line" description="No high demand in your categories right now." />}
          />
        </Panel>

        <Panel
          title="My Offerings"
          description="Each offering, its assigned space and session, and how many learners accepted."
          className="lg:col-span-2"
          flush
          actions={<Button size="sm" href="/offerings">All Offerings</Button>}
        >
          <DataTable
            caption="My offerings"
            columns={offeringColumns}
            rows={data.offerings}
            rowKey={(r) => r.offeringId}
            rowHref={(r) => (r.assigned ? `/allocations/${r.assigned.allocationId}` : `/offerings/${r.offeringId}`)}
            pageSize={10}
            itemLabel="offerings"
            empty={
              <EmptyState
                size="compact"
                icon="calendar-range"
                description="No offerings yet. Create one so Smart Allocation can find it a space."
              />
            }
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
