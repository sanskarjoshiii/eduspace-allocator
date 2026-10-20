import type { EngineContext } from '../context';
import { byAge } from '../flow/assign';
import { type OfferingPlacement, fixedPlacements, learnerFit } from '../flow/fit';
import type { PairCandidate } from '../matching/edges';
import type { RunMetrics } from '../types';
import { computeMetrics } from './metrics';

/**
 * Greedy nearest-space baseline on the same snapshot (README 13.10): each offering in
 * creation order takes the nearest feasible free node; each learner, oldest first, takes
 * the nearest feasible offering with seats left. Uses the same feasibility and scores.
 */
export function runBaseline(ctx: EngineContext, candidates: readonly PairCandidate[][]): RunMetrics {
  const t0 = performance.now();
  const usedNodes = new Set<number>();
  const chosen: PairCandidate[] = [];
  for (const list of candidates) {
    let best: PairCandidate | null = null;
    for (const c of list) {
      if (c.score < ctx.settings.minEdgeScore || usedNodes.has(c.node.index)) continue;
      const d = c.distance?.km ?? 0;
      const bd = best?.distance?.km ?? 0;
      if (best === null || d < bd || (d === bd && c.score > best.score)) best = c;
    }
    if (best) {
      usedNodes.add(best.node.index);
      chosen.push(best);
    }
  }

  const placements: OfferingPlacement[] = [
    ...chosen.map((c) => ({ offering: c.offering, space: c.space, session: c.placement.session, seats: c.offering.batchSize, fixed: false })),
    ...fixedPlacements(ctx),
  ];
  const seatsLeft = new Map(placements.map((p) => [p.offering.id, p.seats]));
  const seatDistances: number[] = [];
  let waitlisted = 0;
  let unmatched = 0;
  for (const req of [...ctx.snapshot.requests].sort(byAge)) {
    let anyFeasible = false;
    let nearest: { id: string; km: number } | null = null;
    for (const p of placements) {
      if (p.offering.categoryId !== req.categoryId) continue;
      const fit = learnerFit(ctx, req, p);
      if (!fit.feasible) continue;
      anyFeasible = true;
      if ((seatsLeft.get(p.offering.id) ?? 0) <= 0) continue;
      if (nearest === null || fit.distanceKm < nearest.km) nearest = { id: p.offering.id, km: fit.distanceKm };
    }
    if (nearest) {
      seatsLeft.set(nearest.id, (seatsLeft.get(nearest.id) ?? 0) - 1);
      seatDistances.push(nearest.km);
    } else if (anyFeasible) waitlisted++;
    else unmatched++;
  }

  return computeMetrics(ctx, {
    allocations: chosen.map((c) => ({ score: c.score, costScore: c.costScore, session: c.placement.session })),
    placements,
    seatDistancesKm: seatDistances,
    waitlisted,
    unmatched,
    runTimeMs: performance.now() - t0,
  });
}
