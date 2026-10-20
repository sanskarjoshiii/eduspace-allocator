import type { EngineContext } from '../context';
import type { OfferingPlacement } from '../flow/fit';
import { areaCategoryKey, demandByAreaCategory } from '../kmeans/demand';
import type { DemandInsightRow } from '../types';

/**
 * Demand insight rows per (area, category): demand = open requests + baseline, seats from
 * allocated and fixed offerings whose space is in the area (target area when unknown).
 * Rows with neither demand nor seats are omitted.
 */
export function buildInsights(ctx: EngineContext, placements: readonly OfferingPlacement[]): DemandInsightRow[] {
  const demand = demandByAreaCategory(ctx.snapshot);
  const seats = new Map<string, number>();
  for (const p of placements) {
    const areaId = p.space.areaId || p.offering.targetAreaId;
    if (!areaId) continue;
    const key = areaCategoryKey(areaId, p.offering.categoryId);
    seats.set(key, (seats.get(key) ?? 0) + p.offering.batchSize);
  }
  const areaOrder = new Map(ctx.snapshot.areas.map((a, i) => [a.id, i]));
  const keys = [...new Set([...demand.keys(), ...seats.keys()])];
  const rows: DemandInsightRow[] = [];
  for (const key of keys) {
    const sep = key.indexOf('|');
    const areaId = key.slice(0, sep);
    const categoryId = key.slice(sep + 1);
    const d = demand.get(key) ?? 0;
    const s = seats.get(key) ?? 0;
    if (d <= 0 && s <= 0) continue;
    rows.push({ areaId, categoryId, demand: d, seatsOffered: s, gap: d - s, level: ctx.levelByArea.get(areaId) ?? 'Medium' });
  }
  rows.sort(
    (a, b) =>
      (areaOrder.get(a.areaId) ?? Infinity) - (areaOrder.get(b.areaId) ?? Infinity) ||
      a.areaId.localeCompare(b.areaId) ||
      a.categoryId.localeCompare(b.categoryId),
  );
  return rows;
}
