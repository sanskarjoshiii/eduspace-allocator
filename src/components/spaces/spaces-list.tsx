'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Badge, Button, DataTable, EmptyState, PageHeader, Panel, PanelGrid, Progress, Select, StatCard, StatusBadge,
  type DataTableColumn,
} from '@/components/ui';
import { useLookups } from '@/hooks/use-lookups';
import { apiGet, type Paged } from '@/lib/api';
import type { Role } from '@/lib/domain';
import { formatInr, formatNumber, formatWindow } from '@/lib/format';
import type { MapPayload } from '@/server/dto/map';
import type { SpaceDto, SpaceFullDto } from '@/server/dto/space';
import { lookupCategories, lookupFacilityTypes, nameMap } from './lookup-helpers';
import { spaceKeys } from './space-keys';

const PAGE_SIZE = 20;

interface Usage { openHours: number; bookedHours: number; freeHours: number }

/** Weekly open / booked hours per space from GET /api/map?layers=unused (owner and Administrator). */
function useSpaceUsage(enabled: boolean) {
  return useQuery({
    queryKey: ['map', 'usage'],
    queryFn: () => apiGet<MapPayload>('/api/map', { layers: 'unused' }),
    enabled,
    select: (d): Record<string, Usage> =>
      Object.fromEntries((d.layers.unused ?? []).map((u) => [u.spaceId, { openHours: u.openHours, bookedHours: u.bookedHours, freeHours: u.freeHours }])),
    staleTime: 60_000,
  });
}

function UsageCell({ usage, active }: { usage?: Usage; active: boolean }) {
  if (!active) return <span className="text-body-sm text-ink-subtle">Switched off</span>;
  if (!usage || usage.openHours === 0) return <span className="text-body-sm text-ink-subtle">No open slots</span>;
  return (
    <div className="flex min-w-36 flex-col gap-1">
      <Progress
        size="sm"
        value={usage.bookedHours}
        max={usage.openHours}
        label={`${formatNumber(usage.bookedHours)} of ${formatNumber(usage.openHours)} hours booked each week`}
        tone={usage.bookedHours / usage.openHours >= 0.5 ? 'success' : 'accent'}
      />
      <span className="font-mono text-delta tabular-nums text-ink-muted">
        {formatNumber(usage.bookedHours)} / {formatNumber(usage.openHours)} h booked
      </span>
    </div>
  );
}

const activeBadge = (s: SpaceDto) => <StatusBadge status={s.isActive ? 'Active' : 'Inactive'} />;

/** Space Giver: My Spaces (or the policies view). */
function MySpaces({ view }: { view: 'list' | 'policies' }) {
  const lookups = useLookups();
  const categoryNames = useMemo(() => nameMap(lookupCategories(lookups.data)), [lookups.data]);
  const q = useQuery({
    queryKey: spaceKeys.list({ mine: 1 }),
    queryFn: () => apiGet<Paged<SpaceFullDto>>('/api/spaces', { mine: 1, pageSize: 200 }),
  });
  const usage = useSpaceUsage(true);
  const rows = q.data?.items ?? [];
  const totals = rows.reduce(
    (acc, s) => {
      const u = usage.data?.[s.id];
      return { seats: acc.seats + s.seatCapacity, idle: acc.idle + (u?.freeHours ?? 0), open: acc.open + (u?.openHours ?? 0), booked: acc.booked + (u?.bookedHours ?? 0) };
    },
    { seats: 0, idle: 0, open: 0, booked: 0 },
  );

  const listColumns: DataTableColumn<SpaceFullDto>[] = [
    { key: 'name', header: 'Space', sortable: true, cell: (s) => <span className="font-medium text-ink">{s.name}</span> },
    { key: 'areaName', header: 'Area', hideBelow: 'sm', sortable: true, sortValue: (s) => s.areaName ?? '' },
    { key: 'seatCapacity', header: 'Seats', align: 'end', sortable: true, cell: (s) => formatNumber(s.seatCapacity) },
    { key: 'usage', header: 'Weekly Use', hideBelow: 'md', cell: (s) => <UsageCell usage={usage.data?.[s.id]} active={s.isActive} />, sortValue: (s) => usage.data?.[s.id]?.bookedHours ?? 0, sortable: true },
    { key: 'isActive', header: 'Status', cell: activeBadge },
  ];

  const policyColumns: DataTableColumn<SpaceFullDto>[] = [
    { key: 'name', header: 'Space', sortable: true, cell: (s) => <span className="font-medium text-ink">{s.name}</span> },
    {
      key: 'approvalMode', header: 'Approval', sortable: true, sortValue: (s) => s.policy.approvalMode,
      cell: (s) => <Badge tone={s.policy.approvalMode === 'manual' ? 'warning' : 'success'}>{s.policy.approvalMode === 'manual' ? 'Manual' : 'Auto'}</Badge>,
    },
    { key: 'rent', header: 'Rent / Hour', align: 'end', sortable: true, sortValue: (s) => s.policy.rentPerHour, cell: (s) => (s.policy.rentPerHour ? formatInr(s.policy.rentPerHour) : 'Free') },
    {
      key: 'categories', header: 'Categories', hideBelow: 'md',
      cell: (s) => (s.policy.allowedCategoryIds.length ? s.policy.allowedCategoryIds.map((id) => categoryNames[id] ?? 'Category').join(', ') : 'All'),
      searchValue: (s) => s.policy.allowedCategoryIds.map((id) => categoryNames[id] ?? '').join(' '),
    },
    { key: 'audiences', header: 'Audiences', hideBelow: 'lg', cell: (s) => (s.policy.allowedAudiences.length ? s.policy.allowedAudiences.join(', ') : 'Everyone') },
    {
      key: 'blocked', header: 'Blocked Slots', hideBelow: 'sm',
      cell: (s) => {
        const blocked = s.slots.filter((x) => x.isBlocked);
        if (blocked.length === 0) return <span className="text-ink-subtle">None</span>;
        return <span className="font-mono text-delta tabular-nums">{blocked.map((b) => formatWindow(b)).join(', ')}</span>;
      },
      sortable: true, sortValue: (s) => s.slots.filter((x) => x.isBlocked).length,
    },
  ];

  const policies = view === 'policies';
  return (
    <>
      <PageHeader
        title={policies ? 'Slots and Policies' : 'My Spaces'}
        description={policies ? 'Approval mode, rent, who may book and which slots are blocked, for each space.' : 'Your registered spaces and how much of their weekly time is booked.'}
        actions={
          <>
            <Button href={policies ? '/spaces' : '/spaces?view=policies'} icon={policies ? 'building-2' : 'settings-2'}>
              {policies ? 'All Spaces' : 'Slots and Policies'}
            </Button>
            <Button variant="primary" icon="plus" href="/spaces/new">Add Space</Button>
          </>
        }
      />
      {!policies ? (
        <PanelGrid columns={3}>
          <Panel>
            <StatCard label="Spaces" icon="building-2" value={formatNumber(rows.length)} loading={q.isPending} footnote={<><strong>{formatNumber(rows.filter((s) => s.isActive).length)}</strong> active</>} />
          </Panel>
          <Panel>
            <StatCard label="Seats" icon="users" value={formatNumber(totals.seats)} loading={q.isPending} />
          </Panel>
          <Panel>
            <StatCard
              label="Idle Hours per Week"
              icon="clock"
              value={formatNumber(totals.idle)}
              loading={q.isPending || usage.isPending}
              footnote={totals.open ? <><strong>{formatNumber(totals.booked)}</strong> of {formatNumber(totals.open)} open hours booked</> : 'Add weekly slots to receive classes.'}
            />
          </Panel>
        </PanelGrid>
      ) : null}
      <Panel title={policies ? 'Policies' : 'Spaces'} description={policies ? 'Open a space to change its policy or block a slot.' : 'Search, sort and open a space to edit it.'}>
        <DataTable
          caption={policies ? 'Space policies' : 'My spaces'}
          columns={policies ? policyColumns : listColumns}
          rows={rows}
          rowKey={(s) => s.id}
          rowHref={(s) => `/spaces/${s.id}`}
          searchable
          searchPlaceholder="Search spaces"
          itemLabel="spaces"
          pageSize={PAGE_SIZE}
          loading={q.isPending}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={
            <EmptyState
              icon="building-2"
              description="No spaces yet. Add your first space to start receiving classes."
              action={<Button size="sm" icon="plus" href="/spaces/new">Add Space</Button>}
              size="compact"
            />
          }
        />
      </Panel>
    </>
  );
}

/** Administrator registry and the public directory share server-mode paging. */
function ServerSpaces({ role }: { role: Role }) {
  const admin = role === 'Administrator';
  const lookups = useLookups();
  const facilityNames = useMemo(() => nameMap(lookupFacilityTypes(lookups.data)), [lookups.data]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [areaId, setAreaId] = useState('');
  const [active, setActive] = useState<'' | 'active' | 'inactive'>('');
  const params = { page, pageSize: PAGE_SIZE, q, areaId };
  const query = useQuery({
    queryKey: spaceKeys.list(params),
    queryFn: () => apiGet<Paged<SpaceDto>>('/api/spaces', params),
    placeholderData: keepPreviousData,
  });
  const usage = useSpaceUsage(admin);
  // The list endpoint has no active filter yet, so the Administrator's filter narrows the loaded page.
  const rows = (query.data?.items ?? []).filter((s) => !active || (active === 'active' ? s.isActive : !s.isActive));

  const adminColumns: DataTableColumn<SpaceDto>[] = [
    { key: 'name', header: 'Space', cell: (s) => <span className="font-medium text-ink">{s.name}</span> },
    { key: 'areaName', header: 'Area', hideBelow: 'sm', cell: (s) => s.areaName ?? '—' },
    { key: 'seatCapacity', header: 'Seats', align: 'end', cell: (s) => formatNumber(s.seatCapacity) },
    { key: 'usage', header: 'Weekly Use', hideBelow: 'lg', cell: (s) => <UsageCell usage={usage.data?.[s.id]} active={s.isActive} /> },
    {
      key: 'approval', header: 'Approval', hideBelow: 'md',
      cell: (s) => (s.visibility === 'full' ? <Badge tone={s.policy.approvalMode === 'manual' ? 'warning' : 'success'}>{s.policy.approvalMode === 'manual' ? 'Manual' : 'Auto'}</Badge> : '—'),
    },
    { key: 'rent', header: 'Rent / Hour', align: 'end', hideBelow: 'md', cell: (s) => (s.visibility === 'full' ? (s.policy.rentPerHour ? formatInr(s.policy.rentPerHour) : 'Free') : '—') },
    { key: 'isActive', header: 'Status', cell: activeBadge },
  ];

  const publicColumns: DataTableColumn<SpaceDto>[] = [
    { key: 'name', header: 'Space', cell: (s) => <span className="font-medium text-ink">{s.name}</span> },
    { key: 'areaName', header: 'Area', hideBelow: 'sm', cell: (s) => s.areaName ?? '—' },
    { key: 'seatCapacity', header: 'Seats', align: 'end', cell: (s) => formatNumber(s.seatCapacity) },
    {
      key: 'facilities', header: 'Facilities', hideBelow: 'md',
      cell: (s) => (s.facilities.length ? s.facilities.filter((f) => f.workingQuantity > 0).map((f) => facilityNames[f.facilityTypeId] ?? 'Facility').join(', ') || 'None working' : 'None listed'),
    },
    { key: 'slots', header: 'Open Slots', align: 'end', hideBelow: 'sm', cell: (s) => formatNumber(s.slots.filter((x) => !x.isBlocked).length) },
  ];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        size="sm"
        aria-label="Area"
        className="w-44"
        placeholder="All areas"
        options={(lookups.data?.areas ?? []).map((a) => ({ value: a.id, label: a.name }))}
        value={areaId}
        onChange={(e) => {
          setAreaId(e.target.value);
          setPage(1);
        }}
      />
      {admin ? (
        <Select
          size="sm"
          aria-label="Status"
          className="w-36"
          options={[
            { value: '', label: 'Any status' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
          value={active}
          onChange={(e) => setActive(e.target.value as typeof active)}
        />
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title={admin ? 'Space Registry' : 'Spaces'}
        description={admin ? 'Every registered space, its seats, policy and weekly use.' : 'Community spaces that host classes, with their facilities and open slots.'}
        actions={admin ? <Button variant="primary" icon="plus" href="/spaces/new">Add Space</Button> : undefined}
      />
      {admin ? (
        <PanelGrid columns={3}>
          <Panel>
            <StatCard label="Spaces" icon="building-2" value={formatNumber(query.data?.total ?? 0)} loading={query.isPending} />
          </Panel>
          <Panel>
            <StatCard
              label="Idle Hours per Week"
              icon="clock"
              value={formatNumber(Object.values(usage.data ?? {}).reduce((n, u) => n + u.freeHours, 0))}
              loading={usage.isPending}
            />
          </Panel>
          <Panel>
            <StatCard
              label="Booked Hours per Week"
              icon="calendar-range"
              value={formatNumber(Object.values(usage.data ?? {}).reduce((n, u) => n + u.bookedHours, 0))}
              loading={usage.isPending}
            />
          </Panel>
        </PanelGrid>
      ) : null}
      <Panel title={admin ? 'All Spaces' : 'Directory'} description={admin ? 'Filter by area or status, search and open a space.' : 'Search by name or address and open a space for details.'}>
        <DataTable
          caption="Spaces"
          columns={admin ? adminColumns : publicColumns}
          rows={rows}
          rowKey={(s) => s.id}
          rowHref={(s) => `/spaces/${s.id}`}
          searchable
          searchPlaceholder="Search spaces"
          toolbar={toolbar}
          itemLabel="spaces"
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={
            <EmptyState
              icon="building-2"
              description={q || areaId || active ? 'No spaces match these filters.' : admin ? 'No spaces registered yet.' : 'No spaces are listed yet.'}
              action={
                areaId || active ? (
                  <Button size="sm" onClick={() => { setAreaId(''); setActive(''); setPage(1); }}>Clear Filters</Button>
                ) : admin ? (
                  <Button size="sm" icon="plus" href="/spaces/new">Add Space</Button>
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

/** /spaces for every role. */
export function SpacesList({ role, view }: { role: Role; view: 'list' | 'policies' }) {
  if (role === 'SpaceGiver') return <MySpaces view={view} />;
  return <ServerSpaces role={role} />;
}
