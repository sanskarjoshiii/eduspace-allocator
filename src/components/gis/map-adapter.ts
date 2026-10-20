// Pure adapter between GET /api/map (MapPayload, src/server/dto/map.ts) and the MapView props
// (MapData, src/components/map/map-types.ts). The two shapes were written separately; this is the
// only place that knows both. No React, no Leaflet: unit-tested in tests/unit/gis-adapter.test.ts.
//
// Privacy: every object is built field by field (never spread), so nothing the API might add later
// leaks into the map. Learner positions only ever arrive as AREA CENTRES and stay that way.
import type { MapPayload } from '@/server/dto/map';
import type { GeoPoint, MapData, MapLayer } from '@/components/map/map-types';
import type { DemandLevel } from '@/lib/domain';

/** MapView layer name -> GET /api/map `layers` name. */
export const API_LAYER: Record<MapLayer, 'spaces' | 'allocations' | 'demand' | 'offers' | 'unused'> = {
  spaces: 'spaces',
  allocations: 'allocations',
  demand: 'demand',
  offers: 'offers',
  unusedHours: 'unused',
};

export interface AdaptOptions {
  /** categoryId -> category name, used for allocation lines (offers carry their own name). */
  categoryNames?: Readonly<Record<string, string>>;
}

const point = (c: readonly [number, number] | readonly number[]): GeoPoint => ({
  type: 'Point',
  coordinates: [Number(c[0] ?? 0), Number(c[1] ?? 0)],
});

/**
 * Converts the API payload into MapView data. [lng, lat] order is kept as is.
 * - Allocation lines: one line per (allocation, learner area centre).
 * - Demand areas without a run-assigned level are left off the heatmap (MapView needs a level).
 */
export function adaptMapPayload(payload: MapPayload | null | undefined, opts: AdaptOptions = {}): MapData {
  const layers = payload?.layers ?? {};
  const names = opts.categoryNames ?? {};
  const out: MapData = {};

  if (layers.spaces) {
    out.spaces = layers.spaces.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      location: point(s.coordinates),
      seats: s.seatCapacity,
      areaName: s.areaName,
      href: `/spaces/${s.id}`,
    }));
  }

  if (layers.allocations) {
    out.allocations = layers.allocations.flatMap((a) =>
      a.to.map((t) => ({
        id: `${a.allocationId}:${t.areaId}`,
        from: point(a.from),
        to: point(t.center),
        spaceName: a.spaceName,
        areaName: t.areaName,
        courseTitle: a.offeringTitle,
        category: names[a.categoryId],
        learners: t.learners,
        href: `/allocations/${a.allocationId}`,
      })),
    );
  }

  if (layers.demand) {
    out.demand = layers.demand
      .filter((d): d is typeof d & { demandLevel: DemandLevel } => d.demandLevel !== null)
      .map((d) => ({
        areaId: d.areaId,
        areaName: d.areaName,
        centre: point(d.center),
        openRequests: d.openRequests,
        level: d.demandLevel,
      }));
  }

  if (layers.offers) {
    out.offers = layers.offers.map((o) => ({
      id: o.allocationId,
      title: o.title,
      location: point(o.coordinates),
      spaceName: o.spaceName,
      category: o.categoryName || names[o.categoryId],
      schedule: o.session,
      distanceKm: o.distanceKm,
      href: `/offerings/${o.offeringId}`,
    }));
  }

  if (layers.unused) {
    out.unusedHours = layers.unused.map((u) => ({
      spaceId: u.spaceId,
      name: u.spaceName,
      location: point(u.coordinates),
      hours: u.freeHours,
    }));
  }

  return out;
}

/** Layers present in the payload, in MapView names. */
export function payloadLayers(payload: MapPayload | null | undefined): MapLayer[] {
  const l = payload?.layers ?? {};
  const out: MapLayer[] = [];
  if (l.spaces) out.push('spaces');
  if (l.allocations) out.push('allocations');
  if (l.demand) out.push('demand');
  if (l.offers) out.push('offers');
  if (l.unused) out.push('unusedHours');
  return out;
}

/** Keeps only the layers that are switched on (MapView then draws exactly what the side panel lists). */
export function pickLayers(data: MapData, on: Readonly<Partial<Record<MapLayer, boolean>>>): MapData {
  return {
    spaces: on.spaces ? data.spaces : undefined,
    allocations: on.allocations ? data.allocations : undefined,
    demand: on.demand ? data.demand : undefined,
    offers: on.offers ? data.offers : undefined,
    unusedHours: on.unusedHours ? data.unusedHours : undefined,
  };
}

export interface MapQueryFilters {
  availableOnly: boolean;
  categoryId: string;
  level: DemandLevel | '';
}

/** Query params for GET /api/map. Layers are omitted so the server returns every layer the role may see. */
export function mapQueryParams(f: MapQueryFilters): Record<string, string | undefined> {
  return {
    availableOnly: f.availableOnly ? '1' : undefined,
    categoryId: f.categoryId || undefined,
    level: f.level || undefined,
  };
}
