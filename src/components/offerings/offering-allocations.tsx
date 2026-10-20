'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable, EmptyState, Panel, Progress, StatusBadge, type DataTableColumn } from '@/components/ui';
import { apiGet, type Paged } from '@/lib/api';
import { formatNumber, formatScore } from '@/lib/format';
import type { AllocationListItemDto } from '@/server/dto/allocation';

const columns: DataTableColumn<AllocationListItemDto>[] = [
  {
    key: 'spaceName', header: 'Space',
    cell: (a) => (
      <div className="flex min-w-0 flex-col">
        <span className="font-medium text-ink">{a.spaceName}</span>
        <span className="text-body-sm text-ink-muted">{a.areaName}</span>
      </div>
    ),
  },
  { key: 'sessionLabel', header: 'Session', cell: (a) => <span className="font-mono tabular-nums">{a.sessionLabel}</span> },
  {
    key: 'seats', header: 'Seats', hideBelow: 'sm',
    cell: (a) => (
      <div className="flex min-w-32 flex-col gap-1">
        <Progress size="sm" value={a.seats.taken} max={a.seats.batchSize || 1} label={`${formatNumber(a.seats.taken)} of ${formatNumber(a.seats.batchSize)} seats held`} />
        <span className="font-mono text-delta tabular-nums text-ink-muted">
          {formatNumber(a.seats.accepted)} accepted · {formatNumber(a.seats.offered + a.seats.proposed)} pending · {formatNumber(a.seats.waitlisted)} waitlisted
        </span>
      </div>
    ),
  },
  { key: 'score', header: 'Compatibility Score', align: 'end', hideBelow: 'md', cell: (a) => <span className="font-mono tabular-nums">{formatScore(a.score)}</span> },
  { key: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
];

/** Allocations of one offering with seat counts (owner, Administrator, and space givers for their own spaces). */
export function OfferingAllocations({ offeringId, batchSize }: { offeringId: string; batchSize: number }) {
  const q = useQuery({
    queryKey: ['allocations', 'list', { offeringId }],
    queryFn: () => apiGet<Paged<AllocationListItemDto>>('/api/allocations', { offeringId, pageSize: 100 }),
  });
  const items = q.data?.items ?? [];
  const live = items.filter((a) => !['Rejected', 'Cancelled', 'Superseded', 'Completed'].includes(a.status));
  const held = live.reduce((n, a) => n + a.seats.taken, 0);
  return (
    <Panel
      title="Allocations and Seats"
      description="Spaces Smart Allocation proposed for this offering and how many seats are held."
      actions={live.length > 0 ? <span className="font-mono text-delta tabular-nums text-ink-muted">{formatNumber(held)} of {formatNumber(batchSize * live.length)} seats held</span> : undefined}
    >
      <DataTable
        caption="Allocations for this offering"
        columns={columns}
        rows={items}
        rowKey={(a) => a.id}
        rowHref={(a) => `/allocations/${a.id}`}
        itemLabel="allocations"
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState icon="list-checks" description="No allocations yet. Smart Allocation proposes a space on its next run." size="compact" />}
      />
    </Panel>
  );
}
