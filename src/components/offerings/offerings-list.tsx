'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, DataTable, EmptyState, PageHeader, Panel, Select, StatusBadge, TabPanel, Tabs, type DataTableColumn } from '@/components/ui';
import { categoryTreeOptions, lookupCategories } from '@/components/spaces/lookup-helpers';
import { offeringKeys } from '@/components/spaces/space-keys';
import { useLookups } from '@/hooks/use-lookups';
import { apiGet, type Paged } from '@/lib/api';
import { OFFERING_STATUSES, type OfferingStatus, type Role } from '@/lib/domain';
import { formatDate, formatInr, formatNumber, formatWindow } from '@/lib/format';
import type { OfferingDto } from '@/server/dto/offering';

const PAGE_SIZE = 20;

const schedule = (o: OfferingDto) =>
  o.windows.length === 0 ? (
    <span className="text-ink-subtle">Flexible</span>
  ) : (
    <span className="font-mono text-delta tabular-nums">
      {o.windows.slice(0, 2).map((w) => formatWindow(w)).join(', ')}
      {o.windows.length > 2 ? ` +${o.windows.length - 2}` : ''}
    </span>
  );

/** /offerings: own (Course Provider), all with filters (Administrator), Open catalogue (Learner, Space Giver). */
export function OfferingsList({ role }: { role: Role }) {
  const provider = role === 'CourseProvider';
  const admin = role === 'Administrator';
  const catalogue = !provider && !admin;
  const lookups = useLookups();
  const categories = useMemo(() => categoryTreeOptions(lookupCategories(lookups.data)), [lookups.data]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<OfferingStatus | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [areaId, setAreaId] = useState('');
  const params = {
    page,
    pageSize: PAGE_SIZE,
    q,
    status: catalogue ? 'Open' : status,
    categoryId,
    areaId,
    mine: provider ? 1 : undefined,
  };
  const query = useQuery({
    queryKey: offeringKeys.list(params),
    queryFn: () => apiGet<Paged<OfferingDto>>('/api/offerings', params),
    placeholderData: keepPreviousData,
  });
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const columns: DataTableColumn<OfferingDto>[] = [
    {
      key: 'title', header: 'Offering',
      cell: (o) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-medium text-ink">{o.title}</span>
          <span className="text-body-sm text-ink-muted">{[o.categoryName, provider ? null : o.providerName].filter(Boolean).join(' · ') || '—'}</span>
        </div>
      ),
    },
    { key: 'startDate', header: 'Starts', cell: (o) => <span className="font-mono tabular-nums">{formatDate(o.startDate)}</span> },
    { key: 'targetAreaName', header: 'Area', hideBelow: 'md', cell: (o) => o.targetAreaName ?? 'Any area' },
    { key: 'windows', header: 'Schedule', hideBelow: 'lg', cell: schedule },
    { key: 'batchSize', header: 'Seats', align: 'end', hideBelow: 'sm', cell: (o) => formatNumber(o.batchSize) },
    { key: 'feePerMonth', header: 'Fee / Month', align: 'end', hideBelow: 'md', cell: (o) => (o.feePerMonth ? formatInr(o.feePerMonth) : 'Free') },
    ...(catalogue ? [] : [{ key: 'status', header: 'Status', cell: (o: OfferingDto) => <StatusBadge status={o.status} /> }]),
  ];

  const filtersSet = Boolean(categoryId || areaId || (!catalogue && status));
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {admin ? (
        <Select
          size="sm"
          aria-label="Status"
          className="w-36"
          placeholder="Any status"
          options={OFFERING_STATUSES.map((s) => ({ value: s, label: s }))}
          value={status}
          onChange={(e) => reset(() => setStatus(e.target.value as OfferingStatus | ''))}
        />
      ) : null}
      <Select
        size="sm"
        aria-label="Category"
        className="w-48"
        placeholder="All categories"
        options={categories.map((c) => ({ value: c.value, label: c.label }))}
        value={categoryId}
        onChange={(e) => reset(() => setCategoryId(e.target.value))}
      />
      <Select
        size="sm"
        aria-label="Area"
        className="w-40"
        placeholder="All areas"
        options={(lookups.data?.areas ?? []).map((a) => ({ value: a.id, label: a.name }))}
        value={areaId}
        onChange={(e) => reset(() => setAreaId(e.target.value))}
      />
    </div>
  );

  const panel = (
    <Panel
      title={catalogue ? 'Catalogue' : provider ? (status ? `${status} Offerings` : 'All Offerings') : 'All Offerings'}
      description={catalogue ? 'Search by title or filter by category and area.' : 'Search, filter and open an offering.'}
    >
      <DataTable
        caption="Offerings"
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(o) => o.id}
        rowHref={(o) => `/offerings/${o.id}`}
        searchable
        searchPlaceholder="Search offerings"
        toolbar={toolbar}
        itemLabel="offerings"
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        empty={
          <EmptyState
            icon="calendar-range"
            description={
              filtersSet || q
                ? 'No offerings match these filters.'
                : provider
                  ? 'No offerings yet. Schedule one of your courses to start matching learners.'
                  : catalogue
                    ? 'No offerings are open right now. Check back soon.'
                    : 'No offerings yet.'
            }
            action={
              filtersSet ? (
                <Button size="sm" onClick={() => reset(() => { setCategoryId(''); setAreaId(''); setStatus(''); })}>Clear Filters</Button>
              ) : provider && !q ? (
                <Button size="sm" icon="plus" href="/offerings/new">Add Offering</Button>
              ) : undefined
            }
            size="compact"
          />
        }
        server={{
          page,
          pageSize: PAGE_SIZE,
          total: query.data?.total ?? 0,
          onPageChange: setPage,
          onSearch: (text) => reset(() => setQ(text)),
        }}
      />
    </Panel>
  );

  return (
    <>
      <PageHeader
        title={provider ? 'Offerings' : admin ? 'Course Offerings' : 'Open Offerings'}
        description={
          provider
            ? 'Scheduled runs of your courses and where each one is in its lifecycle.'
            : admin
              ? 'Every offering across providers, by status, category and area.'
              : 'Courses open for learners right now.'
        }
        actions={provider || admin ? <Button variant="primary" icon="plus" href="/offerings/new">Add Offering</Button> : undefined}
      />
      {provider ? (
        <div className="overflow-x-auto border-b border-border px-4 pt-3 lg:px-6">
          <Tabs
            id="offering-status"
            label="Offering status"
            items={[{ value: '', label: 'All' }, ...OFFERING_STATUSES.map((s) => ({ value: s, label: s }))]}
            value={status}
            onValueChange={(v) => reset(() => setStatus(v as OfferingStatus | ''))}
          />
        </div>
      ) : null}
      {provider ? (
        <TabPanel id="offering-status" value={status} active={status}>
          {panel}
        </TabPanel>
      ) : (
        panel
      )}
    </>
  );
}
