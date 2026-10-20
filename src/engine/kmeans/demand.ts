import type { AreaDemand, DemandLevel, EngineSettings, EngineSnapshot } from '../types';
import { round4 } from '../util/format';
import { kmeans } from './kmeans';
import { StandardScaler, encodeIncomeGroup, silhouetteScore } from './preprocess';

export const FEATURE_NAMES = [
  'population',
  'studentCount',
  'literacyRate',
  'incomeScore',
  'incomeGroup',
  'requestDensity',
  'unmetDemand',
] as const;

const F_INCOME_GROUP = 4;
const F_REQUEST_DENSITY = 5;
const F_UNMET = 6;

export function areaCategoryKey(areaId: string, categoryId: string): string {
  return `${areaId}|${categoryId}`;
}

/** Open requests + baseline per (area, category). */
export function demandByAreaCategory(snapshot: EngineSnapshot): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of snapshot.requests) {
    const key = areaCategoryKey(r.areaId, r.categoryId);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  for (const b of snapshot.demandBaseline) {
    const key = areaCategoryKey(b.areaId, b.categoryId);
    out.set(key, (out.get(key) ?? 0) + b.baseline);
  }
  return out;
}

/** Seats already offered per (area, category) by fixed allocations, before this run. */
export function fixedSeatsByAreaCategory(snapshot: EngineSnapshot): Map<string, number> {
  const spaceArea = new Map(snapshot.spaces.map((s) => [s.id, s.areaId]));
  const out = new Map<string, number>();
  for (const o of snapshot.offerings) {
    if (!o.fixed) continue;
    const areaId = spaceArea.get(o.fixed.spaceId) ?? o.targetAreaId;
    if (!areaId) continue;
    const key = areaCategoryKey(areaId, o.categoryId);
    out.set(key, (out.get(key) ?? 0) + o.batchSize);
  }
  return out;
}

function sumByArea(map: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, v] of map) {
    const areaId = key.slice(0, key.indexOf('|'));
    out.set(areaId, (out.get(areaId) ?? 0) + v);
  }
  return out;
}

/** Raw (unscaled) feature rows in FEATURE_NAMES order, one per area in snapshot order. */
export function areaFeatureRows(snapshot: EngineSnapshot): number[][] {
  const requests = new Map<string, number>();
  for (const r of snapshot.requests) requests.set(r.areaId, (requests.get(r.areaId) ?? 0) + 1);
  const demand = sumByArea(demandByAreaCategory(snapshot));
  const seats = sumByArea(fixedSeatsByAreaCategory(snapshot));
  return snapshot.areas.map((a) => [
    a.population,
    a.studentCount,
    a.literacyRate,
    a.incomeScore,
    encodeIncomeGroup(a.incomeGroup),
    a.studentCount > 0 ? ((requests.get(a.id) ?? 0) / a.studentCount) * 1000 : 0,
    (demand.get(a.id) ?? 0) - (seats.get(a.id) ?? 0),
  ]);
}

/**
 * Combined demand index of a scaled feature vector: request density and unmet demand
 * raise it, a higher income group lowers it.
 */
export function demandIndex(scaled: readonly number[]): number {
  return (scaled[F_REQUEST_DENSITY] ?? 0) + (scaled[F_UNMET] ?? 0) - 0.5 * (scaled[F_INCOME_GROUP] ?? 0);
}

/**
 * Names clusters from their centroid demand indices, independent of cluster numbering.
 * 3+ clusters: top High, bottom Emerging, the rest Medium. 2 clusters: High and Emerging.
 */
export function labelClusters(indices: readonly number[]): DemandLevel[] {
  const n = indices.length;
  if (n === 0) return [];
  if (n === 1) return ['Medium'];
  const order = indices.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
  const labels = new Array<DemandLevel>(n).fill('Medium');
  const top = order[0];
  const bottom = order[n - 1];
  if (top) labels[top.i] = 'High';
  if (bottom) labels[bottom.i] = 'Emerging';
  return labels;
}

export interface DemandClustering {
  areaDemand: AreaDemand[];
  k: number;
  silhouette: number;
}

/**
 * Clusters areas into demand levels (README 13.3): scale features, try k in kMin..kMax
 * (k < number of areas, fallback min(3, n - 1)), keep the best silhouette (smaller k
 * wins ties), label clusters by centroid demand index. With two or fewer areas the
 * areas are labelled directly by their own demand index.
 */
export function clusterAreas(snapshot: EngineSnapshot, settings: EngineSettings): DemandClustering {
  const areas = snapshot.areas;
  const n = areas.length;
  if (n === 0) return { areaDemand: [], k: 0, silhouette: 0 };
  const scaled = new StandardScaler().fitTransform(areaFeatureRows(snapshot));
  const ownIndex = scaled.map(demandIndex);

  if (n <= 2) {
    const levels = labelClusters(ownIndex);
    const order = ownIndex.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
    const rank = new Array<number>(n).fill(0);
    order.forEach((o, r) => (rank[o.i] = r));
    return {
      areaDemand: areas.map((a, i) => ({
        areaId: a.id,
        clusterId: rank[i] ?? 0,
        level: levels[i] ?? 'Medium',
        demandIndex: round4(ownIndex[i] ?? 0),
      })),
      k: n,
      silhouette: 0,
    };
  }

  const kLow = Math.max(2, settings.kMin);
  const kHigh = Math.min(settings.kMax, n - 1);
  const candidates: number[] = [];
  for (let k = kLow; k <= kHigh; k++) candidates.push(k);
  if (candidates.length === 0) candidates.push(Math.min(3, n - 1));

  let best: { k: number; labels: number[]; centroids: number[][]; sil: number } | null = null;
  for (const k of candidates) {
    const res = kmeans(scaled, k, { seed: settings.seed, nInit: settings.kInits });
    const sil = silhouetteScore(scaled, res.labels);
    if (best === null || sil > best.sil + 1e-12) best = { k, labels: res.labels, centroids: res.centroids, sil };
  }
  if (best === null) throw new Error('unreachable: no k candidate');
  const chosen = best;
  const levels = labelClusters(chosen.centroids.map(demandIndex));
  return {
    areaDemand: areas.map((a, i) => {
      const c = chosen.labels[i] ?? 0;
      return { areaId: a.id, clusterId: c, level: levels[c] ?? 'Medium', demandIndex: round4(ownIndex[i] ?? 0) };
    }),
    k: chosen.k,
    silhouette: round4(chosen.sil),
  };
}
