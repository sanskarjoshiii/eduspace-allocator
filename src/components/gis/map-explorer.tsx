'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge, Button, EmptyState, ErrorState, Icon, Panel, PageHeader, PanelGrid, Select, SkeletonText, StatusBadge, cn, type Tone } from '@/components/ui';
import { MapView, type MapLayer } from '@/components/map';
import { useLookups } from '@/hooks/use-lookups';
import { useMe } from '@/hooks/use-me';
import { apiGet } from '@/lib/api';
import { DEMAND_LEVELS, type DemandLevel, type Role } from '@/lib/domain';
import { formatInr, formatKm, formatNumber } from '@/lib/format';
import type { MapPayload, SpaceMapStatus } from '@/server/dto/map';
import { adaptMapPayload, mapQueryParams, payloadLayers, pickLayers, type MapQueryFilters } from './map-adapter';

const LAYER_LABEL: Record<MapLayer, string> = {
  spaces: 'Spaces',
  allocations: 'Allocation Lines',
  demand: 'Demand Heatmap',
  offers: 'Nearby Offers',
  unusedHours: 'Unused Hours',
};

const SPACE_STATUS: Record<SpaceMapStatus, { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'success' },
  booked: { label: 'Booked', tone: 'accent' },
  inactive: { label: 'Inactive', tone: 'neutral' },
};

const DESCRIPTION: Record<Role, string> = {
  Administrator: 'Every space, live allocation, unused hour and area of demand across the service area.',
  SpaceGiver: 'Your spaces with their idle hours, the classes they host and where demand is growing.',
  CourseProvider: 'Spaces you can teach in, where your learners come from and where demand is growing.',
  Learner: 'Classes near your area and the spaces that host them. Distances are measured from your area centre.',
};

function Chip({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label
      className={cn(
        'inline-flex h-control-sm cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 font-mono text-delta transition-colors duration-120 ease-out select-none',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
        checked ? 'border-border-strong bg-surface-tint text-ink' : 'border-border bg-surface text-ink-muted hover:bg-surface-sunken',
      )}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <Icon name={checked ? 'check' : 'plus'} size={12} strokeWidth={2} />
      {children}
    </label>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <h3 className="m-0 flex items-center justify-between font-mono text-label uppercase text-ink-muted">
        <span>{title}</span>
        <span className="tabular-nums">{formatNumber(count)}</span>
      </h3>
      {children}
    </section>
  );
}

function Row({ href, title, meta, aside }: { href?: string; title: ReactNode; meta?: ReactNode; aside?: ReactNode }) {
  const body = (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-body-sm font-medium text-ink">{title}</span>
        {meta ? <span className="text-body-sm text-ink-muted">{meta}</span> : null}
      </div>
      {aside ? <div className="flex flex-none flex-col items-end gap-1">{aside}</div> : null}
    </div>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {body}
        </Link>
      ) : (
        <div className="px-2 py-1.5 -mx-2">{body}</div>
      )}
    </li>
  );
}

const LIST_LIMIT = 8;
const more = (n: number) => (n > LIST_LIMIT ? <p className="m-0 text-body-sm text-ink-subtle">and {formatNumber(n - LIST_LIMIT)} more on the map.</p> : null);

/** GIS map page body: server-side filters, layer toggles, MapView and a list of what is visible. */
export function MapExplorer() {
  const me = useMe();
  const lookups = useLookups();
  const role = me.data?.role;
  const [filters, setFilters] = useState<MapQueryFilters>({ availableOnly: false, categoryId: '', level: '' });
  const [hidden, setHidden] = useState<Partial<Record<MapLayer, boolean>>>({});

  const query = useQuery({
    queryKey: ['map', filters],
    queryFn: () => apiGet<MapPayload>('/api/map', mapQueryParams(filters)),
    placeholderData: keepPreviousData,
  });
  const payload = query.data;

  const categoryNames = useMemo(
    () => Object.fromEntries((lookups.data?.categories ?? []).map((c) => [c.id, c.name])),
    [lookups.data],
  );
  const available = useMemo(() => payloadLayers(payload), [payload]);
  const on = useMemo(
    () => Object.fromEntries(available.map((l) => [l, !hidden[l]])) as Partial<Record<MapLayer, boolean>>,
    [available, hidden],
  );
  const mapData = useMemo(() => pickLayers(adaptMapPayload(payload, { categoryNames }), on), [payload, categoryNames, on]);
  const shownLayers = available.filter((l) => on[l]);

  const layers = payload?.layers ?? {};
  const spaces = on.spaces ? (layers.spaces ?? []) : [];
  const offers = on.offers ? [...(layers.offers ?? [])].sort((a, b) => a.distanceKm - b.distanceKm) : [];
  const unused = on.unusedHours ? [...(layers.unused ?? [])].sort((a, b) => b.freeHours - a.freeHours) : [];
  const demand = on.demand ? [...(layers.demand ?? [])].sort((a, b) => b.openRequests - a.openRequests) : [];
  const allocations = on.allocations ? (layers.allocations ?? []) : [];
  const home = payload?.home ?? null;
  const counts = spaces.reduce<Record<SpaceMapStatus, number>>((acc, s) => ({ ...acc, [s.status]: acc[s.status] + 1 }), {
    available: 0, booked: 0, inactive: 0,
  });

  const categoryOptions = (lookups.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="flex flex-col">
      <PageHeader
        title={role === 'Administrator' ? 'GIS Mapping' : 'GIS Map'}
        description={role ? DESCRIPTION[role] : 'Spaces, classes and demand on one map.'}
      />
      <div className="border-b border-border px-4 py-3 lg:px-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between" role="group" aria-label="Map layers and filters">
          <div className="flex flex-wrap items-center gap-2">
            {available.map((l) => (
              <Chip key={l} checked={Boolean(on[l])} onChange={(v) => setHidden((h) => ({ ...h, [l]: !v }))}>
                {LAYER_LABEL[l]}
              </Chip>
            ))}
            {available.includes('spaces') ? (
              <Chip checked={filters.availableOnly} onChange={(v) => setFilters((f) => ({ ...f, availableOnly: v }))}>
                Available Only
              </Chip>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              size="sm"
              aria-label="Course category"
              className="w-44"
              placeholder="All categories"
              options={categoryOptions}
              value={filters.categoryId}
              onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
            />
            {available.includes('demand') ? (
              <Select
                size="sm"
                aria-label="Demand level"
                className="w-44"
                placeholder="All demand levels"
                options={DEMAND_LEVELS.map((d) => ({ value: d, label: `${d} demand` }))}
                value={filters.level}
                onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value as DemandLevel | '' }))}
              />
            ) : null}
          </div>
        </div>
      </div>

      <PanelGrid columns={3}>
        <Panel className="lg:col-span-2" title="Map" description="Select a marker for details. Learner locations appear only as area centres.">
          <MapView
            data={mapData}
            loading={query.isPending}
            error={query.error}
            onRetry={() => query.refetch()}
            layers={shownLayers}
            showControls={false}
            height={520}
            center={home ? { type: 'Point', coordinates: home.center } : undefined}
            zoom={home ? 13 : undefined}
            label="GIS map"
          />
        </Panel>

        <Panel title="On the Map" description="What the current layers and filters show.">
          {query.isPending ? (
            <SkeletonText lines={8} />
          ) : query.error ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} size="compact" />
          ) : shownLayers.length === 0 ? (
            <EmptyState icon="layers" description="All layers are switched off. Turn one on to see it here." size="compact" />
          ) : (
            <div className="flex flex-col gap-4">
              {home ? (
                <p className="m-0 flex items-center gap-2 text-body-sm text-ink-muted">
                  <Icon name="map-pin" size={16} />
                  <span>
                    Your area: <strong className="font-medium text-ink">{home.areaName} (area centre)</strong>
                  </span>
                </p>
              ) : null}

              {on.offers ? (
                <Section title="Nearby Offers" count={offers.length}>
                  {offers.length === 0 ? (
                    <EmptyState
                      icon="graduation-cap"
                      description="No classes with free seats near your area yet. Submit a learning request to be matched."
                      action={<Button size="sm" href="/requests" icon="inbox">My Requests</Button>}
                      size="compact"
                    />
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {offers.slice(0, LIST_LIMIT).map((o) => (
                        <Row
                          key={o.allocationId}
                          href={`/offerings/${o.offeringId}`}
                          title={o.title}
                          meta={
                            <>
                              {o.spaceName} · <span className="font-mono tabular-nums">{o.session}</span>
                              <br />
                              <span className="font-mono tabular-nums">{formatKm(o.distanceKm)}</span> from {home?.areaName ?? 'your area'} (area centre)
                            </>
                          }
                          aside={
                            <>
                              <Badge tone={o.seatsLeft > 0 ? 'success' : 'neutral'}>{formatNumber(o.seatsLeft)} seats left</Badge>
                              <span className="font-mono text-delta tabular-nums text-ink-muted">
                                {o.feePerMonth ? `${formatInr(o.feePerMonth)}/month` : 'Free'}
                              </span>
                            </>
                          }
                        />
                      ))}
                    </ul>
                  )}
                  {more(offers.length)}
                </Section>
              ) : null}

              {on.unusedHours ? (
                <Section title="Unused Hours" count={unused.length}>
                  {unused.length === 0 ? (
                    <p className="m-0 text-body-sm text-ink-muted">No idle hours this week.</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {unused.slice(0, LIST_LIMIT).map((u) => (
                        <Row
                          key={u.spaceId}
                          href={`/spaces/${u.spaceId}`}
                          title={u.spaceName}
                          meta={
                            u.freeSlots.length ? (
                              <span className="font-mono tabular-nums">{u.freeSlots.slice(0, 3).join(', ')}{u.freeSlots.length > 3 ? ' …' : ''}</span>
                            ) : (
                              `${formatNumber(u.bookedHours)} of ${formatNumber(u.openHours)} h booked`
                            )
                          }
                          aside={<Badge tone="warning">{formatNumber(u.freeHours)} h idle</Badge>}
                        />
                      ))}
                    </ul>
                  )}
                  {more(unused.length)}
                </Section>
              ) : null}

              {on.spaces ? (
                <Section title="Spaces" count={spaces.length}>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(counts) as SpaceMapStatus[]).map((s) =>
                      counts[s] > 0 ? (
                        <Badge key={s} tone={SPACE_STATUS[s].tone}>
                          {formatNumber(counts[s])} {SPACE_STATUS[s].label}
                        </Badge>
                      ) : null,
                    )}
                  </div>
                  {spaces.length === 0 ? (
                    <p className="m-0 text-body-sm text-ink-muted">No spaces match these filters.</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {spaces.slice(0, LIST_LIMIT).map((s) => (
                        <Row
                          key={s.id}
                          href={`/spaces/${s.id}`}
                          title={s.name}
                          meta={`${s.areaName} · ${formatNumber(s.seatCapacity)} seats`}
                          aside={<Badge tone={SPACE_STATUS[s.status].tone}>{SPACE_STATUS[s.status].label}</Badge>}
                        />
                      ))}
                    </ul>
                  )}
                  {more(spaces.length)}
                </Section>
              ) : null}

              {on.allocations ? (
                <Section title="Allocation Lines" count={allocations.length}>
                  {allocations.length === 0 ? (
                    <p className="m-0 text-body-sm text-ink-muted">No live allocations.</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {allocations.slice(0, LIST_LIMIT).map((a) => (
                        <Row
                          key={a.allocationId}
                          href={`/allocations/${a.allocationId}`}
                          title={a.offeringTitle}
                          meta={`${a.spaceName} · learners from ${a.to.map((t) => `${t.areaName} (${formatNumber(t.learners)})`).join(', ') || 'no areas yet'}`}
                          aside={<StatusBadge status={a.status} />}
                        />
                      ))}
                    </ul>
                  )}
                  {more(allocations.length)}
                </Section>
              ) : null}

              {on.demand ? (
                <Section title="Demand" count={demand.length}>
                  {demand.length === 0 ? (
                    <p className="m-0 text-body-sm text-ink-muted">No open demand for these filters.</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {demand.slice(0, LIST_LIMIT).map((d) => (
                        <Row
                          key={d.areaId}
                          title={`${d.areaName} (area centre)`}
                          meta={
                            <>
                              <span className="tabular-nums">{formatNumber(d.openRequests)}</span> open requests ·{' '}
                              <span className="tabular-nums">{formatNumber(d.seatsOffered)}</span> seats offered
                            </>
                          }
                          aside={d.demandLevel ? <StatusBadge status={d.demandLevel} /> : <Badge tone="neutral">Not analysed</Badge>}
                        />
                      ))}
                    </ul>
                  )}
                  {more(demand.length)}
                </Section>
              ) : null}
            </div>
          )}
        </Panel>
      </PanelGrid>
    </div>
  );
}
