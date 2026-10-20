import { type CentreDistance, type EngineContext, categoryName } from '../context';
import { workingQuantity } from '../constraints/check';
import { areaCategoryKey } from '../kmeans/demand';
import type { DemandLevel, EngineOffering, EngineSpace, ScoreBreakdown, SubScoreName, Weights } from '../types';
import { clamp01, formatKm, formatLimitKm, formatRupees, round4 } from '../util/format';

export const LEVEL_BASE: Record<DemandLevel, number> = { High: 1, Medium: 0.6, Emerging: 0.3 };

export type SubScores = Record<SubScoreName, { score: number; detail: string }>;

const ORDER: readonly SubScoreName[] = ['distance', 'time', 'facility', 'capacity', 'cost', 'demand', 'utilisation'];

/** Weighted sum of sub-scores (each clamped to [0, 1]) with a per-criterion breakdown. */
export function combine(weights: Weights, subs: SubScores): { score: number; breakdown: ScoreBreakdown[] } {
  let total = 0;
  const breakdown = ORDER.map((criterion) => {
    const score = clamp01(subs[criterion].score);
    const weight = weights[criterion];
    const weighted = score * weight;
    total += weighted;
    return { criterion, score: round4(score), weight, weighted: round4(weighted), detail: subs[criterion].detail };
  });
  return { score: round4(clamp01(total)), breakdown };
}

export function distanceSubScore(distance: CentreDistance | null, limitKm: number): { score: number; detail: string } {
  if (!distance) return { score: 0.5, detail: 'No demand centre yet, neutral score' };
  return {
    score: clamp01(1 - distance.km / limitKm),
    detail: `${formatKm(distance.km)} from the ${distance.label} (limit ${formatLimitKm(limitKm)})`,
  };
}

/** Required facilities met (0.9 share) plus a bonus of up to 0.1 for spare and extra facilities. */
export function facilitySubScore(ctx: EngineContext, space: EngineSpace, offering: EngineOffering): { score: number; detail: string } {
  const reqs = offering.requirements;
  let met = 0;
  let headroom = 0;
  for (const r of reqs) {
    const w = workingQuantity(space, r.facilityTypeId);
    if (w >= r.minQuantity) met++;
    headroom += r.minQuantity > 0 ? clamp01((w - r.minQuantity) / r.minQuantity) : 1;
  }
  const required = new Set(reqs.map((r) => r.facilityTypeId));
  const extras = space.facilities.filter((f) => f.workingQuantity > 0 && !required.has(f.facilityTypeId)).length;
  const metShare = reqs.length > 0 ? met / reqs.length : 1;
  const headroomShare = reqs.length > 0 ? headroom / reqs.length : 0;
  const bonus = 0.05 * headroomShare + 0.05 * Math.min(1, extras / 3);
  const extraText = `${extras} other facility ${extras === 1 ? 'type' : 'types'}`;
  const detail = reqs.length > 0 ? `${met} of ${reqs.length} required met, ${extraText}` : `No requirements, ${extraText}`;
  return { score: clamp01(0.9 * metShare + bonus), detail };
}

export function costSubScore(rent: number, budget: number | null, unit: string): { score: number; detail: string } {
  if (budget === null) return { score: 1, detail: `${formatRupees(rent)} ${unit}, no budget limit` };
  if (rent <= 0) return { score: 1, detail: `Free, budget ${formatRupees(budget)} ${unit}` };
  if (budget <= 0) return { score: 0, detail: `${formatRupees(rent)} ${unit} against a budget of ${formatRupees(0)}` };
  return { score: clamp01(1 - rent / budget), detail: `${formatRupees(rent)} ${unit} against a budget of ${formatRupees(budget)}` };
}

/** Area demand level adjusted by the normalised pre-run gap for the category. */
export function demandSubScore(ctx: EngineContext, areaId: string | null, categoryId: string): { score: number; detail: string } {
  const level: DemandLevel = (areaId && ctx.levelByArea.get(areaId)) || 'Medium';
  const gap = areaId ? (ctx.baseGap.get(areaCategoryKey(areaId, categoryId)) ?? 0) : 0;
  const g = ctx.maxGap > 0 ? clamp01(gap / ctx.maxGap) : 0;
  const areaName = (areaId && ctx.areaById.get(areaId)?.name) || 'Unknown area';
  return {
    score: clamp01(0.8 * LEVEL_BASE[level] + 0.2 * g),
    detail: `${areaName}: ${level} demand, ${Math.round(gap)} unmet ${categoryName(ctx, categoryId)} learners`,
  };
}

export interface PairScore {
  score: number;
  breakdown: ScoreBreakdown[];
  costScore: number;
}

/** Space–offering compatibility score (README 13.5). */
export function scorePair(
  ctx: EngineContext,
  space: EngineSpace,
  offering: EngineOffering,
  overlapMin: number,
  distance: CentreDistance | null,
): PairScore {
  const maxR = ctx.settings.maxRadiusKm;
  const util = ctx.utilisation.get(space.id) ?? 0;
  const timeScore = offering.windows.length === 0 ? 1 : clamp01(overlapMin / offering.sessionMinutes);
  const cost = costSubScore(space.policy.rentPerHour, offering.maxRentPerHour, 'per hour');
  const subs: SubScores = {
    distance: distanceSubScore(distance, maxR),
    time: {
      score: timeScore,
      detail: offering.windows.length === 0 ? 'Provider is flexible on time' : `${overlapMin} of ${offering.sessionMinutes} min in the preferred time`,
    },
    facility: facilitySubScore(ctx, space, offering),
    capacity: {
      score: space.seatCapacity > 0 ? Math.min(1, offering.batchSize / space.seatCapacity) : 0,
      detail: `Batch of ${offering.batchSize} in ${space.seatCapacity} seats`,
    },
    cost,
    demand: demandSubScore(ctx, offering.targetAreaId ?? space.areaId, offering.categoryId),
    utilisation: { score: 1 - util, detail: `Space is ${Math.round(util * 100)}% booked this week` },
  };
  const { score, breakdown } = combine(ctx.settings.weights, subs);
  return { score, breakdown, costScore: clamp01(cost.score) };
}
