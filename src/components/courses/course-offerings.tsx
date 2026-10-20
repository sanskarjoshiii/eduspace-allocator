'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable, EmptyState, Panel, Skeleton, StatusBadge, type DataTableColumn } from '@/components/ui';
import { offeringKeys } from '@/components/spaces/space-keys';
import { apiGet, type Paged } from '@/lib/api';
import { formatDate, formatInr, formatNumber } from '@/lib/format';
import type { OfferingDto } from '@/server/dto/offering';

const columns: DataTableColumn<OfferingDto>[] = [
  { key: 'startDate', header: 'Starts', cell: (o) => <span className="font-mono tabular-nums">{formatDate(o.startDate)}</span>, sortable: true },
  { key: 'targetAreaName', header: 'Target Area', hideBelow: 'sm', cell: (o) => o.targetAreaName ?? 'Any area' },
  { key: 'batchSize', header: 'Seats', align: 'end', cell: (o) => formatNumber(o.batchSize) },
  { key: 'feePerMonth', header: 'Fee / Month', align: 'end', hideBelow: 'md', cell: (o) => (o.feePerMonth ? formatInr(o.feePerMonth) : 'Free') },
  { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
];

/** Offerings of one course (course detail and edit pages). */
export function CourseOfferings({ courseId }: { courseId: string }) {
  const q = useQuery({
    queryKey: offeringKeys.list({ courseId }),
    queryFn: () => apiGet<Paged<OfferingDto>>('/api/offerings', { courseId, pageSize: 200 }),
  });
  return (
    <Panel title="Offerings" description="Scheduled runs of this course.">
      <DataTable
        caption="Offerings of this course"
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(o) => o.id}
        rowHref={(o) => `/offerings/${o.id}`}
        itemLabel="offerings"
        pageSize={10}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState icon="calendar-range" description="No offerings yet. Add one to put this course in front of learners." size="compact" />}
      />
    </Panel>
  );
}

/** Offerings count for a course row (GET /api/offerings?courseId=&pageSize=1 → total). */
export function OfferingsCount({ courseId }: { courseId: string }) {
  const q = useQuery({
    queryKey: offeringKeys.list({ courseId, count: true }),
    queryFn: () => apiGet<Paged<OfferingDto>>('/api/offerings', { courseId, pageSize: 1 }),
    staleTime: 60_000,
  });
  if (q.isPending) return <Skeleton className="ml-auto h-4 w-6" />;
  if (q.error) return <span className="text-ink-subtle">—</span>;
  return <>{formatNumber(q.data.total)}</>;
}
