'use client';

import dynamic from 'next/dynamic';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { ErrorState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/inputs';
import { Skeleton } from '@/components/ui/skeleton';
import type { GeoPoint } from '@/components/forms/geo';
import { DEMAND_LEVELS, type DemandLevel } from '@/lib/domain';
import { MAP_LAYER_LABEL, MAP_LAYERS, type MapData, type MapFilters, type MapLayer } from './map-types';
import { defaultFilters, filterMapData, mapCategories } from './map-utils';

const MapCanvas = dynamic(() => import('./map-canvas'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

export interface MapViewProps {
  /** Payload of GET /api/map. */
  data?: MapData;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Layers this view offers as toggles; default: layers present in `data`. */
  layers?: readonly MapLayer[];
  /** Initial on/off per layer (default on). */
  initialLayers?: Partial<Record<MapLayer, boolean>>;
  showControls?: boolean;
  showLegend?: boolean;
  /** Map height in px; default 420. */
  height?: number;
  /** Fixed centre; otherwise the view fits the data (Pune when empty). */
  center?: GeoPoint;
  zoom?: number;
  /** Accessible name of the map region. */
  label?: string;
  className?: string;
}

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

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      {swatch}
      {children}
    </li>
  );
}

const dot = (cls: string) => <span aria-hidden className={cn('size-2.5 rounded-pill border border-surface', cls)} />;
const ring = (cls: string) => <span aria-hidden className={cn('size-3 rounded-pill border-[1.5px]', cls)} />;

/**
 * GIS map with layers (spaces by status, allocation lines, demand areas, offers, unused hours),
 * toggles for layers / available only / category / demand level, and a legend.
 * Leaflet loads client-side only; colours come from the theme tokens at runtime.
 */
export function MapView({
  data, loading, error, onRetry, layers, initialLayers, showControls = true, showLegend = true, height = 420, center, zoom, label = 'Map', className,
}: MapViewProps) {
  const ids = useId();
  const [filters, setFilters] = useState<MapFilters>(() => defaultFilters(MAP_LAYERS, initialLayers));
  const available = useMemo(() => layers ?? MAP_LAYERS.filter((l) => (data?.[l]?.length ?? 0) > 0), [layers, data]);
  const categories = useMemo(() => mapCategories(data), [data]);
  const effective = useMemo<MapFilters>(
    () => ({ ...filters, layers: Object.fromEntries(MAP_LAYERS.map((l) => [l, filters.layers[l] && available.includes(l)])) as Record<MapLayer, boolean> }),
    [filters, available],
  );
  const filtered = useMemo(() => filterMapData(data, effective), [data, effective]);

  const setLayer = (l: MapLayer, v: boolean) => setFilters((f) => ({ ...f, layers: { ...f.layers, [l]: v } }));
  const summary = `${label}: ${filtered.spaces.length} spaces, ${filtered.demand.length} demand areas, ${filtered.offers.length} offers, ${filtered.allocations.length} allocations shown`;

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {showControls && available.length > 0 ? (
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between" role="group" aria-label="Map layers and filters">
          <div className="flex flex-wrap items-center gap-2">
            {available.map((l) => (
              <Chip key={l} checked={filters.layers[l]} onChange={(v) => setLayer(l, v)}>
                {MAP_LAYER_LABEL[l]}
              </Chip>
            ))}
            {available.includes('spaces') ? (
              <Chip checked={filters.availableOnly} onChange={(v) => setFilters((f) => ({ ...f, availableOnly: v }))}>
                Available Only
              </Chip>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {categories.length > 0 ? (
              <Select
                size="sm"
                aria-label="Course category"
                id={`${ids}-cat`}
                className="w-44"
                placeholder="All categories"
                options={categories.map((c) => ({ value: c, label: c }))}
                value={filters.category}
                onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
              />
            ) : null}
            {available.includes('demand') ? (
              <Select
                size="sm"
                aria-label="Demand level"
                id={`${ids}-lvl`}
                className="w-40"
                placeholder="All demand levels"
                options={DEMAND_LEVELS.map((d) => ({ value: d, label: `${d} demand` }))}
                value={filters.demandLevel}
                onChange={(e) => setFilters((f) => ({ ...f, demandLevel: e.target.value as DemandLevel | '' }))}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <div style={{ height }} className="relative min-w-0">
        {error ? (
          <div className="grid h-full place-items-center rounded-lg border border-border bg-surface-sunken">
            <ErrorState error={error} onRetry={onRetry} message="The map could not load. Try again in a moment." size="compact" />
          </div>
        ) : loading ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : (
          <MapCanvas data={filtered} height={height} center={center} zoom={zoom} label={summary} />
        )}
      </div>

      {showLegend && available.length > 0 ? (
        <ul aria-label="Map legend" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 font-mono text-delta text-ink-muted">
          {available.includes('spaces') ? (
            <>
              <LegendItem swatch={dot('bg-success')}>Available space</LegendItem>
              <LegendItem swatch={dot('bg-accent')}>Booked space</LegendItem>
              <LegendItem swatch={dot('bg-border-strong')}>Inactive space</LegendItem>
            </>
          ) : null}
          {available.includes('allocations') ? (
            <LegendItem swatch={<span aria-hidden className="h-0.5 w-4 rounded-pill bg-info" />}>Allocation (to area centre)</LegendItem>
          ) : null}
          {available.includes('demand') ? (
            <>
              <LegendItem swatch={ring('border-accent bg-accent-tint')}>High demand</LegendItem>
              <LegendItem swatch={ring('border-info bg-info-tint')}>Medium demand</LegendItem>
              <LegendItem swatch={ring('border-success bg-success-tint')}>Emerging demand</LegendItem>
            </>
          ) : null}
          {available.includes('offers') ? (
            <LegendItem swatch={<span aria-hidden className="size-2.5 rotate-45 rounded-xs bg-info" />}>Course offer</LegendItem>
          ) : null}
          {available.includes('unusedHours') ? (
            <LegendItem swatch={<span aria-hidden className="h-3 w-5 rounded-xs bg-warning-tint shadow-[inset_0_0_0_1px_var(--border)]" />}>Idle hours per week</LegendItem>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
