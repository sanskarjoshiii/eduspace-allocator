'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { MapView } from '@/components/map';
import {
  Button, DataTable, Delta, EmptyState, ErrorState, Field, PageHeader, Panel, PanelGrid, Select, StatCard, StatusBadge, Tag,
  type DataTableColumn,
} from '@/components/ui';
import { useLookups } from '@/hooks/use-lookups';
import { apiGet } from '@/lib/api';
import { DEMAND_LEVELS, type DemandLevel, type Role } from '@/lib/domain';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { AreaDemandDto, DemandInsightDto, DemandInsightList } from '@/server/dto/insight';
import { toDemandMapData } from './demand-map';

const LEVEL_ORDER: Record<DemandLevel, number> = { High: 0, Medium: 1, Emerging: 2 };

const columns: DataTableColumn<DemandInsightDto>[] = [
  {
    key: 'areaName',
    header: 'Area',
    sortable: true,
    cell: (r) => (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{r.areaName}</span>
        {r.isOwnArea ? <Tag tone="accent">Your Area</Tag> : null}
      </div>
    ),
    searchValue: (r) => `${r.areaName} ${r.categoryName}`,
  },
  { key: 'categoryName', header: 'Category', sortable: true, hideBelow: 'sm' },
  { key: 'level', header: 'Level', sortable: true, sortValue: (r) => LEVEL_ORDER[r.level], cell: (r) => <StatusBadge status={r.level} /> },
  { key: 'demand', header: 'Demand', align: 'end', sortable: true, cell: (r) => formatNumber(r.demand) },
  { key: 'seatsOffered', header: 'Seats Offered', align: 'end', sortable: true, hideBelow: 'md', cell: (r) => formatNumber(r.seatsOffered) },
  {
    key: 'gap',
    header: 'Gap',
    align: 'end',
    sortable: true,
    cell: (r) => (r.gap === 0 ? <span className="font-mono text-data text-ink-muted">0</span> : <Delta value={r.gap} suffix="" digits={0} invert />),
  },
];

export function DemandInsightsScreen({ role }: { role: Role }) {
  const lookups = useLookups();
  const [categoryId, setCategoryId] = useState('');
  const [level, setLevel] = useState<DemandLevel | ''>('');
  const [areaId, setAreaId] = useState('');

  const insights = useQuery({
    queryKey: ['demand-insights', { categoryId, level, areaId }],
    queryFn: () => apiGet<DemandInsightList>('/api/demand-insights', { categoryId, level, areaId }),
    placeholderData: keepPreviousData,
  });
  const areas = useQuery({
    queryKey: ['demand-insights', 'areas', { categoryId, level }],
    queryFn: () => apiGet<{ items: AreaDemandDto[] }>('/api/demand-insights/areas', { categoryId, level }),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => insights.data?.items ?? [], [insights.data]);
  const mapData = useMemo(() => {
    const items = areas.data?.items ?? [];
    return toDemandMapData(areaId ? items.filter((a) => a.areaId === areaId) : items);
  }, [areas.data, areaId]);
  const ownRows = useMemo(() => rows.filter((r) => r.isOwnArea), [rows]);
  const totals = useMemo(
    () => ({
      demand: rows.reduce((s, r) => s + r.demand, 0),
      seats: rows.reduce((s, r) => s + r.seatsOffered, 0),
      gap: rows.reduce((s, r) => s + Math.max(0, r.gap), 0),
      highAreas: new Set(rows.filter((r) => r.level === 'High').map((r) => r.areaId)).size,
    }),
    [rows],
  );

  const filtered = Boolean(categoryId || level || areaId);
  const clear = () => {
    setCategoryId('');
    setLevel('');
    setAreaId('');
  };
  const learner = role === 'Learner';
  const computedAt = insights.data?.computedAt;

  return (
    <>
      <PageHeader
        title="Demand Insights"
        description={
          learner
            ? 'Which courses people near you are asking for, and how many seats are on offer. Always shown as area totals.'
            : 'Where learners want courses, how many seats are offered and where the gaps are. Always shown as area totals.'
        }
        meta={computedAt ? <span className="font-mono text-data text-ink-muted">Updated {formatDateTime(computedAt)}</span> : null}
      />

      <PanelGrid columns={1}>
        <Panel title="Filters" description="Narrow by course category, demand level and area." icon="filter">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Category">
              <Select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={lookups.isPending}
                options={[{ value: '', label: 'All categories' }, ...(lookups.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              />
            </Field>
            <Field label="Demand Level">
              <Select
                value={level}
                onChange={(e) => setLevel(e.target.value as DemandLevel | '')}
                options={[{ value: '', label: 'All levels' }, ...DEMAND_LEVELS.map((l) => ({ value: l, label: l }))]}
              />
            </Field>
            <Field label="Area">
              <Select
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
                disabled={lookups.isPending}
                options={[{ value: '', label: 'All areas' }, ...(lookups.data?.areas ?? []).map((a) => ({ value: a.id, label: a.name }))]}
              />
            </Field>
          </div>
          {filtered ? (
            <div className="mt-3">
              <Button size="sm" variant="ghost" icon="x" onClick={clear}>
                Clear Filters
              </Button>
            </div>
          ) : null}
        </Panel>
      </PanelGrid>

      {learner && ownRows.length > 0 ? <OwnAreaSummary rows={ownRows} /> : null}

      <PanelGrid columns={3}>
        <Panel>
          <StatCard icon="inbox" label="Demand" value={formatNumber(totals.demand)} loading={insights.isPending} footnote="Learners asking, across the rows below." />
        </Panel>
        <Panel>
          <StatCard
            icon="graduation-cap"
            label="Seats Offered"
            value={formatNumber(totals.seats)}
            loading={insights.isPending}
            footnote={<><strong>{formatNumber(totals.gap)}</strong> more seats are needed to meet demand.</>}
          />
        </Panel>
        <Panel>
          <StatCard icon="map-pin" label="High-Demand Areas" value={formatNumber(totals.highAreas)} loading={insights.isPending} footnote="Areas where demand is highest right now." />
        </Panel>
      </PanelGrid>

      <PanelGrid columns={1}>
        <Panel title="Demand Map" description="Each circle is an area centre, sized by open requests and coloured by demand level." icon="map" flush>
          <div className="px-4 pb-4 lg:px-6 lg:pb-6">
            <MapView
              data={mapData}
              loading={areas.isPending}
              error={areas.error}
              onRetry={() => areas.refetch()}
              layers={['demand']}
              showControls={false}
              height={420}
              label="Demand by area"
            />
          </div>
        </Panel>
        <Panel title="Demand by Area and Category" description="Gap is demand minus seats offered. A positive gap means more seats are needed." icon="chart-column">
          {insights.isError ? (
            <ErrorState error={insights.error} onRetry={() => insights.refetch()} />
          ) : (
            <DataTable
              caption="Demand by area and category"
              columns={columns}
              rows={rows}
              rowKey={(r) => `${r.areaId}-${r.categoryId}`}
              searchable
              searchPlaceholder="Search areas or categories"
              itemLabel="rows"
              pageSize={15}
              loading={insights.isPending}
              empty={
                filtered ? (
                  <EmptyState icon="search" size="compact" description="No demand matches these filters." action={<Button variant="ghost" onClick={clear}>Clear Filters</Button>} />
                ) : (
                  <EmptyState icon="chart-line" size="compact" description="No Demand Insights yet. They appear after the next Smart Allocation run." />
                )
              }
            />
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}

function OwnAreaSummary({ rows }: { rows: DemandInsightDto[] }) {
  const areaName = rows[0]?.areaName ?? 'Your area';
  const demand = rows.reduce((s, r) => s + r.demand, 0);
  const seats = rows.reduce((s, r) => s + r.seatsOffered, 0);
  const top = [...rows].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.gap - a.gap).slice(0, 5);
  return (
    <PanelGrid columns={2}>
      <Panel title={`${areaName} at a Glance`} description="Totals for your own area, across every course category." icon="map-pin">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard label="People Asking" value={formatNumber(demand)} />
          <StatCard label="Seats Offered" value={formatNumber(seats)} footnote={seats >= demand ? 'Enough seats for current demand.' : <><strong>{formatNumber(demand - seats)}</strong> more seats needed.</>} />
        </div>
      </Panel>
      <Panel title="Most Requested Near You" description="Course categories with the highest demand in your area." icon="chart-line">
        <ul className="m-0 flex list-none flex-col p-0">
          {top.map((r) => (
            <li key={r.categoryId} className="flex items-center justify-between gap-3 border-b border-dashed border-border-strong py-2 last:border-b-0">
              <span className="min-w-0 truncate text-ink">{r.categoryName}</span>
              <span className="flex flex-none items-center gap-2">
                <span className="font-mono text-data tabular-nums text-ink-muted">{formatNumber(r.demand)} asking</span>
                <StatusBadge status={r.level} />
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </PanelGrid>
  );
}
