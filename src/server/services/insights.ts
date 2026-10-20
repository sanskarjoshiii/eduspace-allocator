import { Types } from 'mongoose';
import { Area, CourseCategory, DemandInsight, LearnerProfile, LearningRequest } from '@/server/models';
import { OPEN_REQUEST_STATUSES, type DemandLevel } from '@/lib/domain';
import type { AreaDemandDto, DemandInsightDto, DemandInsightList } from '@/server/dto/insight';
import type { SessionUser } from '@/server/auth/session';

// ---- Shared geo helpers (used by alerts, recommendations, analytics and map) ----

/** Great-circle distance in km between two [lng, lat] points. */
export function haversineKm(a: readonly [number, number] | number[], b: readonly [number, number] | number[]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lng1 = 0, lat1 = 0] = a;
  const [lng2 = 0, lat2 = 0] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function pointOf(p: { coordinates?: number[] | null } | null | undefined): [number, number] {
  const c = p?.coordinates ?? [];
  return [c[0] ?? 0, c[1] ?? 0];
}

/** The learner's home area: profile area, else the area of their most recent request. */
export async function learnerAreaId(userId: string): Promise<Types.ObjectId | null> {
  const uid = new Types.ObjectId(userId);
  const profile = await LearnerProfile.findOne({ userId: uid }).select('areaId').lean();
  if (profile?.areaId) return profile.areaId;
  const latest = await LearningRequest.findOne({ learnerUserId: uid }).sort({ createdAt: -1 }).select('areaId').lean();
  return latest?.areaId ?? null;
}

// ---- Demand insights ----

export interface InsightFilters {
  areaId?: string;
  categoryId?: string;
  level?: DemandLevel;
}

const LEVEL_RANK: Record<DemandLevel, number> = { High: 0, Medium: 1, Emerging: 2 };

/**
 * Aggregated demand by area and category for every role. Rows are counts only; no
 * individual learner is ever returned. A learner's own area is listed first.
 */
export async function listInsights(user: SessionUser, filters: InsightFilters): Promise<DemandInsightList> {
  const q: Record<string, unknown> = {};
  if (filters.areaId) q.areaId = new Types.ObjectId(filters.areaId);
  if (filters.categoryId) q.categoryId = new Types.ObjectId(filters.categoryId);
  if (filters.level) q.level = filters.level;

  const ownArea = user.role === 'Learner' ? await learnerAreaId(user.id) : null;
  const rows = await DemandInsight.find(q).lean();
  const [areas, categories] = await Promise.all([
    Area.find({ _id: { $in: [...new Set(rows.map((r) => r.areaId.toString()))] } }).select('name center').lean(),
    CourseCategory.find({ _id: { $in: [...new Set(rows.map((r) => r.categoryId.toString()))] } }).select('name').lean(),
  ]);
  const areaById = new Map(areas.map((a) => [a._id.toString(), a]));
  const catById = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const own = ownArea?.toString() ?? null;

  const items: DemandInsightDto[] = rows.map((r) => {
    const area = areaById.get(r.areaId.toString());
    return {
      areaId: r.areaId.toString(),
      areaName: area?.name ?? 'Unknown area',
      areaCenter: pointOf(area?.center),
      categoryId: r.categoryId.toString(),
      categoryName: catById.get(r.categoryId.toString()) ?? 'Unknown category',
      level: r.level as DemandLevel,
      demand: r.demand,
      seatsOffered: r.seatsOffered,
      gap: r.gap,
      computedAt: new Date(r.computedAt ?? Date.now()).toISOString(),
      isOwnArea: own !== null && r.areaId.toString() === own,
    };
  });
  items.sort(
    (a, b) =>
      Number(b.isOwnArea) - Number(a.isOwnArea) ||
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      b.gap - a.gap ||
      a.areaName.localeCompare(b.areaName) ||
      a.categoryName.localeCompare(b.categoryName),
  );
  const latest = items.reduce<string | null>((m, r) => (m === null || r.computedAt > m ? r.computedAt : m), null);
  return { items, ownAreaId: own, computedAt: latest };
}

/** Per-area totals (demand, seats, gap, open requests) for heatmaps. Every area is listed. */
export async function areaTotals(filters: { categoryId?: string; level?: DemandLevel } = {}): Promise<AreaDemandDto[]> {
  const match: Record<string, unknown> = {};
  if (filters.categoryId) match.categoryId = new Types.ObjectId(filters.categoryId);
  const reqMatch: Record<string, unknown> = { status: { $in: OPEN_REQUEST_STATUSES } };
  if (filters.categoryId) reqMatch.categoryId = new Types.ObjectId(filters.categoryId);

  const [areas, sums, open] = await Promise.all([
    Area.find(filters.level ? { demandLevel: filters.level } : {}).select('name center demandLevel demandIndex').lean(),
    DemandInsight.aggregate<{ _id: Types.ObjectId; demand: number; seatsOffered: number; gap: number; categories: number }>([
      { $match: match },
      { $group: { _id: '$areaId', demand: { $sum: '$demand' }, seatsOffered: { $sum: '$seatsOffered' }, gap: { $sum: '$gap' }, categories: { $sum: 1 } } },
    ]),
    LearningRequest.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: reqMatch }, { $group: { _id: '$areaId', n: { $sum: 1 } } }]),
  ]);
  const sumBy = new Map(sums.map((s) => [s._id.toString(), s]));
  const openBy = new Map(open.map((o) => [o._id.toString(), o.n]));
  return areas
    .map((a) => {
      const s = sumBy.get(a._id.toString());
      return {
        areaId: a._id.toString(),
        areaName: a.name,
        areaCenter: pointOf(a.center),
        demandLevel: (a.demandLevel ?? null) as DemandLevel | null,
        demandIndex: a.demandIndex ?? null,
        demand: s?.demand ?? 0,
        seatsOffered: s?.seatsOffered ?? 0,
        gap: s?.gap ?? 0,
        openRequests: openBy.get(a._id.toString()) ?? 0,
        categories: s?.categories ?? 0,
      };
    })
    .sort((a, b) => b.gap - a.gap || b.openRequests - a.openRequests || a.areaName.localeCompare(b.areaName));
}
