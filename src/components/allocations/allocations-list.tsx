'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { ALLOCATION_LABEL, ALLOCATION_STATUSES, type Role } from '@/lib/domain';
import { formatDateTime, formatKm, formatNumber } from '@/lib/format';
import {
  Badge, Button, DataTable, EmptyState, PageHeader, Panel, Progress, ScoreBar, Select, StatusBadge,
  type DataTableColumn,
} from '@/components/ui';
import {
  allocationKeys, type AllocationListItemDto, type AllocationListResponse, type LearnerAllocationDto,
} from './allocation-hooks';

export interface AllocationFilters {
  status?: string;
  runId?: string;
  offeringId?: string;
  spaceId?: string;
}

const PAGE_SIZE = 25;

const COPY: Record<Role, { title: string; description: string }> = {
  Administrator: { title: 'Allocation Results', description: 'Every class Smart Allocation placed, with its space, session and compatibility score.' },
  SpaceGiver: { title: 'Allocations', description: 'Classes placed in your spaces and what needs your approval.' },
  CourseProvider: { title: 'Assigned Spaces', description: 'The space and session assigned to each of your offerings.' },
  Learner: { title: 'My Classes', description: 'Classes you hold a place in.' },
};

function buildQuery(filters: AllocationFilters, page: number) {
  return { page, pageSize: PAGE_SIZE, status: filters.status, runId: filters.runId, offeringId: filters.offeringId, spaceId: filters.spaceId };
}

const staffColumns = (role: Role): DataTableColumn<AllocationListItemDto>[] => [
  {
    key: 'courseTitle', header: 'Offering',
    cell: (r) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-ink">{r.courseTitle}</span>
        <span className="truncate text-body-sm text-ink-muted">{r.categoryName}</span>
      </div>
    ),
  },
  {
    key: 'spaceName', header: role === 'SpaceGiver' ? 'Your Space' : 'Space', hideBelow: 'sm',
    cell: (r) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-ink">{r.spaceName}</span>
        <span className="truncate text-body-sm text-ink-muted">{r.areaName}</span>
      </div>
    ),
  },
  { key: 'sessionLabel', header: 'Session', cell: (r) => <span className="font-mono text-data whitespace-nowrap">{r.sessionLabel}</span> },
  {
    key: 'score', header: 'Compatibility Score', hideBelow: 'md', width: '160px',
    cell: (r) => <ScoreBar score={r.score} size="sm" label={`Compatibility score for ${r.courseTitle}`} showLabel={false} className="min-w-24" />,
  },
  {
    key: 'distanceKm', header: 'Distance', align: 'end', hideBelow: 'lg',
    cell: (r) => <span className="font-mono text-data">{r.distanceKm === null ? '—' : formatKm(r.distanceKm)}</span>,
  },
  {
    key: 'status', header: 'Status',
    cell: (r) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={r.status} />
        {r.replacesAllocationId ? <Badge tone="warning">Reallocation</Badge> : null}
      </div>
    ),
  },
  {
    key: 'seats', header: 'Seats', align: 'end', hideBelow: 'sm', width: '140px',
    cell: (r) => (
      <div className="flex min-w-24 flex-col items-end gap-1">
        <span className="font-mono text-data tabular-nums">
          {formatNumber(r.seats.taken)} / {formatNumber(r.seats.batchSize)}
        </span>
        <Progress size="sm" value={r.seats.taken} max={Math.max(1, r.seats.batchSize)} label={`${r.seats.taken} of ${r.seats.batchSize} seats held`} className="w-full" />
      </div>
    ),
  },
];

const learnerColumns: DataTableColumn<LearnerAllocationDto>[] = [
  { key: 'courseTitle', header: 'Course' },
  { key: 'spaceName', header: 'Space', hideBelow: 'sm', cell: (r) => `${r.spaceName}, ${r.areaName}` },
  { key: 'sessionLabel', header: 'Session', cell: (r) => <span className="font-mono text-data whitespace-nowrap">{r.sessionLabel}</span> },
  { key: 'status', header: 'Class', hideBelow: 'sm', cell: (r) => <StatusBadge status={r.status} /> },
  {
    key: 'myEnrollment', header: 'My Place',
    cell: (r) =>
      r.myEnrollment ? (
        <div className="flex flex-col gap-0.5">
          <StatusBadge status={r.myEnrollment.status} />
          {r.myEnrollment.status === 'Offered' && r.myEnrollment.offerExpiresAt ? (
            <span className="font-mono text-data text-ink-muted">Until {formatDateTime(r.myEnrollment.offerExpiresAt)}</span>
          ) : null}
          {r.myEnrollment.waitlistRank ? <span className="font-mono text-data text-ink-muted">Rank {r.myEnrollment.waitlistRank}</span> : null}
        </div>
      ) : (
        '—'
      ),
  },
];

/** Role-scoped allocation list over GET /api/allocations (filters from the query string). */
export function AllocationsList({ role, initialFilters }: { role: Role; initialFilters: AllocationFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<AllocationFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const isLearner = role === 'Learner';
  const copy = COPY[role];

  const query = useQuery({
    queryKey: allocationKeys.list({ ...filters, page, role }),
    queryFn: () => apiGet<AllocationListResponse<AllocationListItemDto | LearnerAllocationDto>>('/api/allocations', buildQuery(filters, page)),
    placeholderData: keepPreviousData,
  });

  const updateFilters = (next: AllocationFilters) => {
    setFilters(next);
    setPage(1);
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const scoped = Boolean(filters.runId || filters.offeringId || filters.spaceId);
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Filter by status"
        size="sm"
        value={filters.status ?? ''}
        placeholder="All statuses"
        options={ALLOCATION_STATUSES.map((s) => ({ value: s, label: ALLOCATION_LABEL[s] }))}
        onChange={(e) => updateFilters({ ...filters, status: e.target.value || undefined })}
      />
      {scoped ? (
        <Button size="sm" variant="ghost" icon="x" onClick={() => updateFilters({ status: filters.status })}>
          Clear Filters
        </Button>
      ) : null}
    </div>
  );

  const scopeNote = filters.runId
    ? 'Showing allocations from one Smart Allocation run.'
    : filters.offeringId
      ? 'Showing allocations for one offering.'
      : filters.spaceId
        ? 'Showing allocations for one space.'
        : null;

  const empty = (
    <EmptyState
      icon="list-checks"
      size="compact"
      description={
        filters.status || scoped
          ? 'No allocations match these filters.'
          : role === 'SpaceGiver'
            ? 'No classes placed in your spaces yet. Add open slots to start receiving classes.'
            : role === 'CourseProvider'
              ? 'No spaces assigned yet. Open an offering so Smart Allocation can place it.'
              : 'No allocations yet. They appear after the next Smart Allocation run.'
      }
      action={
        filters.status || scoped ? (
          <Button size="sm" onClick={() => updateFilters({})}>
            Clear Filters
          </Button>
        ) : role === 'Administrator' ? (
          <Button size="sm" href="/runs">
            Open Smart Allocation
          </Button>
        ) : undefined
      }
    />
  );

  const common = {
    rowKey: (r: { id: string }) => r.id,
    rowHref: (r: { id: string }) => `/allocations/${r.id}`,
    itemLabel: 'allocations',
    loading: query.isPending,
    error: query.error,
    onRetry: () => void query.refetch(),
    toolbar: isLearner ? undefined : toolbar,
    empty,
    server: { page, pageSize: PAGE_SIZE, total: query.data?.meta.total ?? 0, onPageChange: setPage },
  };

  return (
    <>
      <PageHeader title={copy.title} description={copy.description} meta={scopeNote ? <span className="text-body-sm text-ink-muted">{scopeNote}</span> : undefined} />
      <Panel title={isLearner ? 'Classes' : 'All Allocations'} description="Open an allocation to see why Smart Allocation chose this space.">
        {isLearner ? (
          <DataTable caption="My classes" columns={learnerColumns} rows={(query.data?.items ?? []) as LearnerAllocationDto[]} {...common} />
        ) : (
          <DataTable caption={copy.title} columns={staffColumns(role)} rows={(query.data?.items ?? []) as AllocationListItemDto[]} {...common} />
        )}
      </Panel>
    </>
  );
}
