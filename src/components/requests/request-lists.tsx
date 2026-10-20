'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Button, DataTable, EmptyState, PageHeader, Panel, Select, StatusBadge, type DataTableColumn,
} from '@/components/ui';
import { useLookups } from '@/hooks/use-lookups';
import { apiGet, type Paged } from '@/lib/api';
import { ENROLLMENT_STATUSES, REQUEST_STATUSES } from '@/lib/domain';
import { formatDate } from '@/lib/format';
import { categoryOptions, formatMonth, formatWindows, requestKeys, type MatchedRequestDto, type RequestFullDto } from './request-utils';

const PAGE_SIZE = 20;

const statusOptions = REQUEST_STATUSES.map((s) => ({ value: s, label: s }));

// ---- Learner: My Requests ----

const learnerColumns: DataTableColumn<RequestFullDto>[] = [
  {
    key: 'categoryName',
    header: 'Course',
    cell: (r) => (
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-ink">{r.categoryName ?? 'Course request'}</span>
        <span className="text-body-sm text-ink-muted sm:hidden">{r.areaName ?? '—'}</span>
      </span>
    ),
  },
  { key: 'areaName', header: 'Area', hideBelow: 'sm', cell: (r) => r.areaName ?? '—' },
  { key: 'windows', header: 'Preferred Times', hideBelow: 'md', cell: (r) => <span className="font-mono text-data">{formatWindows(r.windows)}</span> },
  { key: 'startMonth', header: 'Starts', hideBelow: 'lg', cell: (r) => <span className="font-mono text-data">{formatMonth(r.startMonth)}</span> },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
];

export function LearnerRequests() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const params = { page, pageSize: PAGE_SIZE, status };
  const query = useQuery({
    queryKey: requestKeys.mine(params),
    queryFn: () => apiGet<Paged<RequestFullDto>>('/api/requests/mine', params),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="My Requests"
        description="Courses you asked for and where each request stands."
        actions={
          <Button variant="primary" icon="plus" href="/requests/new">
            New Request
          </Button>
        }
      />
      <Panel title="All Requests" description="Open a request to see its timeline and suggestions.">
        <DataTable
          caption="My learning requests"
          columns={learnerColumns}
          rows={query.data?.items ?? []}
          rowKey={(r) => r.id}
          rowHref={(r) => `/requests/${r.id}`}
          itemLabel="requests"
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          toolbar={
            <Select
              aria-label="Filter by status"
              size="sm"
              value={status}
              placeholder="All statuses"
              options={statusOptions}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            />
          }
          empty={
            <EmptyState
              icon="inbox"
              size="compact"
              description={status ? 'No requests with this status.' : 'No requests yet. Tell us what you want to learn and we will find a class near you.'}
              action={status ? undefined : <Button href="/requests/new" icon="plus">New Request</Button>}
            />
          }
          server={{ page, pageSize: PAGE_SIZE, total: query.data?.total ?? 0, onPageChange: setPage }}
        />
      </Panel>
    </>
  );
}

// ---- Administrator: Learning Requests ----

const adminColumns: DataTableColumn<RequestFullDto>[] = [
  {
    key: 'learnerName',
    header: 'Learner',
    cell: (r) => (
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-ink">{r.learnerName ?? 'Learner'}</span>
        <span className="text-body-sm text-ink-muted">{r.categoryName ?? '—'}</span>
      </span>
    ),
  },
  { key: 'areaName', header: 'Area', hideBelow: 'sm', cell: (r) => r.areaName ?? '—' },
  { key: 'windows', header: 'Preferred Times', hideBelow: 'lg', cell: (r) => <span className="font-mono text-data">{formatWindows(r.windows)}</span> },
  { key: 'startMonth', header: 'Starts', hideBelow: 'md', cell: (r) => <span className="font-mono text-data">{formatMonth(r.startMonth)}</span> },
  { key: 'createdAt', header: 'Submitted', hideBelow: 'md', cell: (r) => <span className="font-mono text-data">{formatDate(r.createdAt)}</span> },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
];

export function AdminRequests() {
  const lookups = useLookups();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [areaId, setAreaId] = useState('');
  const params = { page, pageSize: PAGE_SIZE, q, status, categoryId, areaId };
  const query = useQuery({
    queryKey: requestKeys.list(params),
    queryFn: () => apiGet<Paged<RequestFullDto>>('/api/requests', params),
    placeholderData: keepPreviousData,
  });
  const catOptions = useMemo(
    () => categoryOptions((lookups.data?.categories ?? []) as { id: string; name: string; parentId?: string | null }[]),
    [lookups.data],
  );
  const areaOptions = useMemo(
    () => [...(lookups.data?.areas ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ value: a.id, label: a.name })),
    [lookups.data],
  );
  const filtered = Boolean(q || status || categoryId || areaId);
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Learning Requests" description="Every learner request, its area, timings and status." />
      <Panel title="All Requests" description="Filter by status, course or area, or search by learner name or notes.">
        <DataTable
          caption="Learning requests"
          columns={adminColumns}
          rows={query.data?.items ?? []}
          rowKey={(r) => r.id}
          rowHref={(r) => `/requests/${r.id}`}
          searchable
          searchPlaceholder="Search learners or notes"
          itemLabel="requests"
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          toolbar={
            <div className="flex flex-wrap gap-2">
              <Select aria-label="Filter by status" size="sm" value={status} placeholder="All statuses" options={statusOptions} onChange={(e) => reset(() => setStatus(e.target.value))} />
              <Select aria-label="Filter by course category" size="sm" value={categoryId} placeholder="All categories" options={catOptions} onChange={(e) => reset(() => setCategoryId(e.target.value))} />
              <Select aria-label="Filter by area" size="sm" value={areaId} placeholder="All areas" options={areaOptions} onChange={(e) => reset(() => setAreaId(e.target.value))} />
            </div>
          }
          empty={
            <EmptyState
              icon="inbox"
              size="compact"
              description={filtered ? 'No requests match these filters.' : 'No learning requests yet. They appear here as learners submit them.'}
              action={
                filtered ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setStatus('');
                      setCategoryId('');
                      setAreaId('');
                      setPage(1);
                    }}
                  >
                    Clear Filters
                  </Button>
                ) : undefined
              }
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
    </>
  );
}

// ---- Course Provider / Space Giver: matched requests ----

/** What the redacted learner part allows us to show, per stage. */
function learnerCell(m: MatchedRequestDto) {
  const l = m.learner;
  if (l.visibility === 'provider-accepted') {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-ink">{l.name}</span>
        <span className="text-body-sm text-ink-muted">{[l.contactPhone, l.contactEmail].filter(Boolean).join(' · ') || 'No contact on file'}</span>
      </span>
    );
  }
  if (l.visibility === 'roster') return <span className="font-medium text-ink">{l.name}</span>;
  return <span className="text-body-sm text-ink-muted">Shared after the learner accepts</span>;
}

const matchedColumns: DataTableColumn<MatchedRequestDto>[] = [
  { key: 'offeringTitle', header: 'Class', cell: (m) => <span className="font-medium text-ink">{m.offeringTitle ?? 'Class'}</span> },
  { key: 'learner', header: 'Learner', cell: learnerCell },
  {
    key: 'area',
    header: 'Area',
    hideBelow: 'sm',
    cell: (m) => ('areaName' in m.learner ? `${m.learner.areaName} (area centre)` : '—'),
  },
  {
    key: 'windows',
    header: 'Preferred Times',
    hideBelow: 'lg',
    cell: (m) => ('windows' in m.learner ? <span className="font-mono text-data">{formatWindows(m.learner.windows)}</span> : '—'),
  },
  { key: 'enrollmentStatus', header: 'Status', cell: (m) => <StatusBadge status={m.enrollmentStatus} /> },
];

const enrollmentStatusOptions = ENROLLMENT_STATUSES.filter((s) => !['Declined', 'Expired', 'Cancelled'].includes(s)).map((s) => ({ value: s, label: s }));

export function MatchedRequests({ role }: { role: 'CourseProvider' | 'SpaceGiver' }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const params = { page, pageSize: PAGE_SIZE, q, status };
  const query = useQuery({
    queryKey: requestKeys.matched(params),
    queryFn: () => apiGet<Paged<MatchedRequestDto>>('/api/requests/matched', params),
    placeholderData: keepPreviousData,
  });
  const description =
    role === 'CourseProvider'
      ? 'Learners matched to your classes. Names and contact details appear once a learner accepts.'
      : 'Learners matched to classes at your spaces. Names appear for entry once a learner accepts.';

  return (
    <>
      <PageHeader title="Matched Requests" description={description} />
      <Panel title="Matched Learners" description="Before acceptance you see only the area and preferred times.">
        <DataTable
          caption="Matched requests"
          columns={matchedColumns}
          rows={query.data?.items ?? []}
          rowKey={(m) => `${m.requestId}-${m.enrollmentId}`}
          rowHref={(m) => `/requests/${m.requestId}`}
          searchable
          searchPlaceholder="Search classes or names"
          itemLabel="requests"
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          toolbar={
            <Select
              aria-label="Filter by status"
              size="sm"
              value={status}
              placeholder="All statuses"
              options={enrollmentStatusOptions}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            />
          }
          empty={<EmptyState icon="users" size="compact" description="No matched learners yet. They appear here when Smart Allocation proposes your class." />}
          server={{
            page,
            pageSize: PAGE_SIZE,
            total: query.data?.total ?? 0,
            onPageChange: setPage,
            onSearch: (text) => {
              setQ(text);
              setPage(1);
            },
          }}
        />
      </Panel>
    </>
  );
}
