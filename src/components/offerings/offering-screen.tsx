'use client';

import { notFound } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, EmptyState, ErrorState, KeyValueList, PageHeader, Panel, PanelGrid, StatusBadge, Tag } from '@/components/ui';
import { DetailSkeleton } from '@/components/spaces/space-screen';
import { offeringKeys } from '@/components/spaces/space-keys';
import { useMe } from '@/hooks/use-me';
import { ApiError, apiGet } from '@/lib/api';
import { formatDate, formatInr, formatNumber, formatWindow } from '@/lib/format';
import type { OfferingDto } from '@/server/dto/offering';
import { OfferingAllocations } from './offering-allocations';
import { OfferingForm } from './offering-form';

function OfferingDetail({ offering, showAllocations }: { offering: OfferingDto; showAllocations: boolean }) {
  const windows = [...offering.windows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  return (
    <>
      <PageHeader
        title={offering.title}
        description={`Offered by ${offering.providerName ?? 'a course provider'}${offering.targetAreaName ? ` near ${offering.targetAreaName}` : ''}.`}
        meta={
          <>
            <StatusBadge status={offering.status} />
            {offering.categoryName ? <Tag tone="accent">{offering.categoryName}</Tag> : null}
          </>
        }
        actions={<Button href={`/courses/${offering.courseId}`} icon="book-open">View Course</Button>}
      />
      <PanelGrid columns={2}>
        <Panel title="Details" description="Who it is for, when it starts and what it costs.">
          <KeyValueList
            items={[
              { label: 'Audience', value: offering.audience },
              { label: 'Batch size', value: `${formatNumber(offering.batchSize)} seats`, mono: true },
              { label: 'Session length', value: `${formatNumber(offering.sessionMinutes)} min`, mono: true },
              { label: 'Duration', value: `${formatNumber(offering.durationWeeks)} weeks`, mono: true },
              { label: 'Starts', value: formatDate(offering.startDate), mono: true },
              { label: 'Target area', value: offering.targetAreaName ?? 'Any area' },
              { label: 'Fee per month', value: offering.feePerMonth ? formatInr(offering.feePerMonth) : 'Free', mono: true },
            ]}
          />
        </Panel>
        <Panel title="Preferred Windows" description="Times the course provider would like to teach.">
          {windows.length === 0 ? (
            <EmptyState icon="calendar" description="Flexible: any slot long enough for a session." size="compact" />
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {windows.map((w, i) => (
                <li key={i}>
                  <Badge tone="neutral" className="font-mono tabular-nums">{formatWindow(w)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PanelGrid>
      {showAllocations ? <OfferingAllocations offeringId={offering.id} batchSize={offering.batchSize} /> : null}
    </>
  );
}

/** /offerings/[id]: edit for the owner and Administrators, catalogue detail for others. */
export function OfferingScreen({ id }: { id: string }) {
  const me = useMe();
  const q = useQuery({ queryKey: offeringKeys.detail(id), queryFn: () => apiGet<OfferingDto>(`/api/offerings/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });
  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 422)) notFound();
  if (q.isPending || me.isPending) return <DetailSkeleton />;
  if (q.error) {
    return (
      <>
        <PageHeader title="Offering" />
        <ErrorState error={q.error} onRetry={() => q.refetch()} className="m-6" />
      </>
    );
  }
  const role = me.data?.role;
  if (q.data.canEdit) return <OfferingForm key={q.data.updatedAt ?? q.data.id} offering={q.data} isAdmin={role === 'Administrator'} />;
  return <OfferingDetail offering={q.data} showAllocations={role === 'SpaceGiver'} />;
}
