import type { EngineContext } from '../context';
import { workingQuantity } from '../constraints/check';
import { LEVEL_BASE } from '../scoring';
import type { DemandLevel, EngineOffering, EngineRequest, EngineSpace, TimeWindow } from '../types';
import { clamp01 } from '../util/format';
import { haversineKm } from '../util/geo';
import { overlapWithUnion, windowMinutes } from '../util/time';

/** An offering that has a space and session this run (newly proposed or fixed). */
export interface OfferingPlacement {
  offering: EngineOffering;
  space: EngineSpace;
  session: TimeWindow;
  /** Seats open to learners in this run. */
  seats: number;
  fixed: boolean;
}

export type LearnerCheck = 'category' | 'audience' | 'distance' | 'time' | 'budget' | 'facilities';
export const LEARNER_CHECK_ORDER: readonly LearnerCheck[] = ['category', 'audience', 'distance', 'time', 'budget', 'facilities'];

export type LearnerFit =
  | { feasible: true; score: number; distanceKm: number }
  | { feasible: false; failed: LearnerCheck; distanceKm: number; missingFacilityId?: string };

/** Placements of offerings with a kept allocation; remaining seats = batchSize − seatsTaken. */
export function fixedPlacements(ctx: EngineContext): OfferingPlacement[] {
  const out: OfferingPlacement[] = [];
  for (const offering of ctx.snapshot.offerings) {
    if (!offering.fixed) continue;
    const space = ctx.spaceById.get(offering.fixed.spaceId);
    if (!space) continue;
    out.push({
      offering,
      space,
      session: offering.fixed.session,
      seats: Math.max(0, offering.batchSize - offering.fixed.seatsTaken),
      fixed: true,
    });
  }
  return out;
}

/** The learner's effective travel limit. */
export function learnerLimitKm(ctx: EngineContext, req: EngineRequest): number {
  return Math.min(req.maxDistanceKm, ctx.settings.maxRadiusKm);
}

/** Learner time fit: share of the session inside the learner's windows (1 when flexible). */
export function learnerTimeFit(req: EngineRequest, session: TimeWindow): number {
  if (req.windows.length === 0) return 1;
  const len = windowMinutes(session);
  return len > 0 ? clamp01(overlapWithUnion(session, req.windows) / len) : 0;
}

/**
 * Learner–offering feasibility and score. Feasible when category and audience match, the
 * space is within the learner's limit, the session overlaps the learner's windows, the fee
 * fits the budget and every facility the learner needs is working at the space. The score
 * blends distance, time, cost, facility and demand with the run weights; capacity and
 * utilisation are neutral (1).
 */
export function learnerFit(ctx: EngineContext, req: EngineRequest, pl: OfferingPlacement): LearnerFit {
  const o = pl.offering;
  const distanceKm = haversineKm(req.location, pl.space.location);
  if (o.categoryId !== req.categoryId) return { feasible: false, failed: 'category', distanceKm };
  if (o.audience !== req.audience) return { feasible: false, failed: 'audience', distanceKm };
  const limit = learnerLimitKm(ctx, req);
  if (distanceKm > limit) return { feasible: false, failed: 'distance', distanceKm };
  const time = learnerTimeFit(req, pl.session);
  if (time <= 0) return { feasible: false, failed: 'time', distanceKm };
  const fee = o.feePerMonth;
  const budget = req.budgetPerMonth;
  if (fee !== null && budget !== null && fee > budget) return { feasible: false, failed: 'budget', distanceKm };
  for (const f of req.requiredFacilityTypeIds) {
    if (workingQuantity(pl.space, f) < 1) return { feasible: false, failed: 'facilities', distanceKm, missingFacilityId: f };
  }
  const w = ctx.settings.weights;
  const level: DemandLevel = ctx.levelByArea.get(req.areaId) ?? 'Medium';
  const dist = limit > 0 ? clamp01(1 - distanceKm / limit) : 1;
  const cost = fee === null || budget === null || fee <= 0 ? 1 : budget > 0 ? clamp01(1 - fee / budget) : 0;
  const score =
    w.distance * dist +
    w.time * time +
    w.cost * cost +
    w.facility +
    w.capacity +
    w.utilisation +
    w.demand * LEVEL_BASE[level];
  return { feasible: true, score: Math.round(clamp01(score) * 10000) / 10000, distanceKm };
}
