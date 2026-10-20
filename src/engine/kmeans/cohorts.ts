import type { Cohort, EngineRequest, EngineSettings, EngineSnapshot } from '../types';
import { meanPoint, projectKm } from '../util/geo';
import { kmeans } from './kmeans';

export const DEFAULT_BATCH_SIZE = 15;

/** Median batch size of the category's open offerings (fallback 15), floored, at least 1. */
export function targetBatchSize(snapshot: EngineSnapshot, categoryId: string): number {
  const sizes = snapshot.offerings
    .filter((o) => o.categoryId === categoryId && o.batchSize > 0)
    .map((o) => o.batchSize)
    .sort((a, b) => a - b);
  if (sizes.length === 0) return DEFAULT_BATCH_SIZE;
  const mid = Math.floor(sizes.length / 2);
  const median = sizes.length % 2 === 1 ? (sizes[mid] ?? 0) : ((sizes[mid - 1] ?? 0) + (sizes[mid] ?? 0)) / 2;
  return Math.max(1, Math.floor(median));
}

/** Splits a group of point indices until no part is larger than `limit`. */
function splitOversized(points: readonly number[][], group: number[], limit: number, seed: number, nInit: number): number[][] {
  if (group.length <= limit) return [group];
  const k = Math.ceil(group.length / limit);
  const res = kmeans(
    group.map((i) => points[i] ?? [0, 0]),
    k,
    { seed, nInit },
  );
  const parts = new Map<number, number[]>();
  res.labels.forEach((l, j) => {
    const list = parts.get(l) ?? [];
    list.push(group[j] ?? 0);
    parts.set(l, list);
  });
  const groups = [...parts.values()];
  // Coincident points can defeat K-Means: fall back to fixed-size chunks along x.
  if (groups.length <= 1) {
    const sorted = [...group].sort((a, b) => (points[a]?.[0] ?? 0) - (points[b]?.[0] ?? 0) || a - b);
    const chunks: number[][] = [];
    for (let i = 0; i < sorted.length; i += limit) chunks.push(sorted.slice(i, i + limit));
    return chunks;
  }
  return groups.flatMap((g) => splitOversized(points, g, limit, seed, nInit));
}

/**
 * Learner cohorts (README 13.3): per category, K-Means on equirectangular-projected
 * coordinates with k = ceil(requests / target batch size). Oversized clusters are split,
 * so no cohort exceeds the batch size.
 */
export function buildCohorts(snapshot: EngineSnapshot, settings: EngineSettings): Cohort[] {
  const byCategory = new Map<string, EngineRequest[]>();
  for (const r of snapshot.requests) {
    const list = byCategory.get(r.categoryId) ?? [];
    list.push(r);
    byCategory.set(r.categoryId, list);
  }
  const cohorts: Cohort[] = [];
  for (const categoryId of [...byCategory.keys()].sort()) {
    const reqs = byCategory.get(categoryId) ?? [];
    const batch = targetBatchSize(snapshot, categoryId);
    const ref = meanPoint(reqs.map((r) => r.location));
    const pts = reqs.map((r) => projectKm(r.location, ref));
    const res = kmeans(pts, Math.ceil(reqs.length / batch), { seed: settings.seed, nInit: settings.kInits });
    const groups = new Map<number, number[]>();
    res.labels.forEach((l, i) => {
      const g = groups.get(l) ?? [];
      g.push(i);
      groups.set(l, g);
    });
    const built = [...groups.values()]
      .flatMap((g) => splitOversized(pts, g, batch, settings.seed, settings.kInits))
      .filter((g) => g.length > 0)
      .map((g) => {
        const members = g.map((i) => reqs[i]).filter((r): r is EngineRequest => r !== undefined);
        return { categoryId, centroid: meanPoint(members.map((m) => m.location)), requestIds: members.map((m) => m.id) };
      })
      .sort((a, b) => b.requestIds.length - a.requestIds.length || (a.requestIds[0] ?? '').localeCompare(b.requestIds[0] ?? ''));
    cohorts.push(...built);
  }
  return cohorts;
}
