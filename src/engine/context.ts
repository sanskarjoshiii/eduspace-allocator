import { buildCohorts } from './kmeans/cohorts';
import { clusterAreas, demandByAreaCategory, fixedSeatsByAreaCategory } from './kmeans/demand';
import type {
  AreaDemand,
  Cohort,
  DemandLevel,
  EngineArea,
  EngineCategory,
  EngineOffering,
  EngineRequest,
  EngineSettings,
  EngineSnapshot,
  EngineSpace,
  GeoPoint,
  TimeWindow,
} from './types';
import { haversineKm } from './util/geo';
import { overlapMinutes, sameWindow, windowMinutes } from './util/time';

/** Where an offering's learners are: cohort centroids of its category, or its target area. */
export interface DemandCentre {
  points: GeoPoint[];
  label: 'cohort centre' | 'target area centre';
}

export interface CentreDistance {
  km: number;
  label: DemandCentre['label'];
}

/** Precomputed lookups shared by every pipeline stage. Built once per run. */
export interface EngineContext {
  snapshot: EngineSnapshot;
  settings: EngineSettings;
  areaById: Map<string, EngineArea>;
  categoryById: Map<string, EngineCategory>;
  facilityName: Map<string, string>;
  spaceById: Map<string, EngineSpace>;
  offeringById: Map<string, EngineOffering>;
  requestById: Map<string, EngineRequest>;
  areaDemand: AreaDemand[];
  levelByArea: Map<string, DemandLevel>;
  clusterByArea: Map<string, number>;
  k: number;
  silhouette: number;
  cohorts: Cohort[];
  cohortsByCategory: Map<string, Cohort[]>;
  /** Pre-run gap per (area, category): open requests + baseline − fixed seats. */
  baseGap: Map<string, number>;
  maxGap: number;
  /** Space bookings, plus fixed allocations' sessions when missing from the list. */
  bookingsBySpace: Map<string, TimeWindow[]>;
  /** Booked minutes / open slot minutes, per space. */
  utilisation: Map<string, number>;
  centreCache: Map<string, DemandCentre | null>;
}

function computeUtilisation(space: EngineSpace, bookings: readonly TimeWindow[]): number {
  let open = 0;
  let booked = 0;
  for (const slot of space.slots) {
    if (slot.isBlocked) continue;
    open += windowMinutes(slot);
    for (const b of bookings) booked += overlapMinutes(slot, b);
  }
  return open > 0 ? Math.min(1, booked / open) : 0;
}

/** Builds the shared context: lookups, demand clustering, cohorts, gaps, bookings, utilisation. */
export function buildContext(snapshot: EngineSnapshot, settings: EngineSettings): EngineContext {
  const demand = clusterAreas(snapshot, settings);
  const cohorts = buildCohorts(snapshot, settings);
  const cohortsByCategory = new Map<string, Cohort[]>();
  for (const c of cohorts) {
    const list = cohortsByCategory.get(c.categoryId) ?? [];
    list.push(c);
    cohortsByCategory.set(c.categoryId, list);
  }

  const baseGap = demandByAreaCategory(snapshot);
  for (const [key, seats] of fixedSeatsByAreaCategory(snapshot)) baseGap.set(key, (baseGap.get(key) ?? 0) - seats);
  let maxGap = 0;
  for (const g of baseGap.values()) maxGap = Math.max(maxGap, g);

  const bookingsBySpace = new Map<string, TimeWindow[]>();
  for (const s of snapshot.spaces) bookingsBySpace.set(s.id, [...s.bookings]);
  for (const o of snapshot.offerings) {
    if (!o.fixed) continue;
    const list = bookingsBySpace.get(o.fixed.spaceId);
    if (list && !list.some((b) => sameWindow(b, o.fixed?.session ?? b))) list.push(o.fixed.session);
  }
  const utilisation = new Map<string, number>();
  for (const s of snapshot.spaces) utilisation.set(s.id, computeUtilisation(s, bookingsBySpace.get(s.id) ?? []));

  return {
    snapshot,
    settings,
    areaById: new Map(snapshot.areas.map((a) => [a.id, a])),
    categoryById: new Map(snapshot.categories.map((c) => [c.id, c])),
    facilityName: new Map(snapshot.facilityTypes.map((f) => [f.id, f.name])),
    spaceById: new Map(snapshot.spaces.map((s) => [s.id, s])),
    offeringById: new Map(snapshot.offerings.map((o) => [o.id, o])),
    requestById: new Map(snapshot.requests.map((r) => [r.id, r])),
    areaDemand: demand.areaDemand,
    levelByArea: new Map(demand.areaDemand.map((a) => [a.areaId, a.level])),
    clusterByArea: new Map(demand.areaDemand.map((a) => [a.areaId, a.clusterId])),
    k: demand.k,
    silhouette: demand.silhouette,
    cohorts,
    cohortsByCategory,
    baseGap,
    maxGap,
    bookingsBySpace,
    utilisation,
    centreCache: new Map(),
  };
}

export function categoryName(ctx: EngineContext, categoryId: string): string {
  return ctx.categoryById.get(categoryId)?.name ?? 'this category';
}

export function facilityLabel(ctx: EngineContext, facilityTypeId: string): string {
  return (ctx.facilityName.get(facilityTypeId) ?? facilityTypeId).toLowerCase();
}

/**
 * The offering's demand centre: cohort centroids of its category (only those within the
 * radius of its target area when it has one), else the target area centre, else null.
 */
export function demandCentre(ctx: EngineContext, offering: EngineOffering): DemandCentre | null {
  if (ctx.centreCache.has(offering.id)) return ctx.centreCache.get(offering.id) ?? null;
  const cohorts = ctx.cohortsByCategory.get(offering.categoryId) ?? [];
  const area = offering.targetAreaId ? ctx.areaById.get(offering.targetAreaId) : undefined;
  let centre: DemandCentre | null = null;
  if (area) {
    const near = cohorts.filter((c) => haversineKm(c.centroid, area.center) <= ctx.settings.maxRadiusKm);
    centre = near.length > 0
      ? { points: near.map((c) => c.centroid), label: 'cohort centre' }
      : { points: [area.center], label: 'target area centre' };
  } else if (cohorts.length > 0) {
    centre = { points: cohorts.map((c) => c.centroid), label: 'cohort centre' };
  }
  ctx.centreCache.set(offering.id, centre);
  return centre;
}

/** Distance from a point to the nearest point of the offering's demand centre; null when it has none. */
export function centreDistance(ctx: EngineContext, offering: EngineOffering, at: GeoPoint): CentreDistance | null {
  const centre = demandCentre(ctx, offering);
  if (!centre) return null;
  let km = Infinity;
  for (const p of centre.points) km = Math.min(km, haversineKm(at, p));
  return { km, label: centre.label };
}
