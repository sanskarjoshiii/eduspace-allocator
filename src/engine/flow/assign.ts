import { type EngineContext, categoryName, facilityLabel } from '../context';
import type { EngineRequest, LearnerAssignment } from '../types';
import { formatLimitKm, formatRupees } from '../util/format';
import { formatWindow } from '../util/time';
import { LEARNER_CHECK_ORDER, type LearnerFit, type OfferingPlacement, learnerFit, learnerLimitKm } from './fit';
import { MinCostFlow } from './mincost';

export interface LearnerOption {
  placement: OfferingPlacement;
  score: number;
  distanceKm: number;
}

export interface AssignmentOutcome {
  assignments: LearnerAssignment[];
  unmatched: { request: EngineRequest; reason: string }[];
  /** Feasible options per request, best first. */
  options: Map<string, LearnerOption[]>;
}

/** Requests ordered oldest first (fairness), id as tie-breaker. */
export function byAge(a: EngineRequest, b: EngineRequest): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id);
}

/** Plain-language reason why no placement fits, from the check the nearest-to-fitting offering failed. */
export function unmatchedReason(ctx: EngineContext, req: EngineRequest, placements: readonly OfferingPlacement[]): string {
  const cat = categoryName(ctx, req.categoryId);
  const same = placements.filter((p) => p.offering.categoryId === req.categoryId);
  if (same.length === 0) {
    const exists = ctx.snapshot.offerings.some((o) => o.categoryId === req.categoryId);
    return exists ? `No ${cat} offering has a space yet` : `No open ${cat} offering yet`;
  }
  let best: { fit: Extract<LearnerFit, { feasible: false }>; pl: OfferingPlacement } | null = null;
  for (const pl of same) {
    const fit = learnerFit(ctx, req, pl);
    if (fit.feasible) continue;
    if (
      best === null ||
      LEARNER_CHECK_ORDER.indexOf(fit.failed) > LEARNER_CHECK_ORDER.indexOf(best.fit.failed) ||
      (fit.failed === best.fit.failed && fit.distanceKm < best.fit.distanceKm)
    ) {
      best = { fit, pl };
    }
  }
  if (!best) return `No ${cat} offering fits`;
  const { fit, pl } = best;
  switch (fit.failed) {
    case 'audience':
      return `No open ${cat} offering for ${req.audience}`;
    case 'distance':
      return `No open ${cat} offering within ${formatLimitKm(learnerLimitKm(ctx, req))}`;
    case 'time':
      return `${cat} offerings nearby run outside your times (closest: ${formatWindow(pl.session)})`;
    case 'budget':
      return `${cat} offerings nearby cost more than your budget (${formatRupees(pl.offering.feePerMonth ?? 0)} per month against ${formatRupees(req.budgetPerMonth ?? 0)})`;
    case 'facilities':
      return `${cat} offerings nearby lack a facility you need (${facilityLabel(ctx, fit.missingFacilityId ?? '')})`;
    default:
      return `No ${cat} offering fits`;
  }
}

/**
 * Learner assignment (README 13.6) as min-cost flow, one independent graph per category:
 * source → learner (cap 1), learner → offering (cost from 1 − score), offering → sink
 * (cap = seats). Costs are lexicographic: round((1 − score) × 1000) first, then an age rank
 * so older requests win exact ties. Feasible leftovers join the best offering's waitlist.
 */
export function assignLearners(ctx: EngineContext, placements: readonly OfferingPlacement[]): AssignmentOutcome {
  const requests = [...ctx.snapshot.requests].sort(byAge);
  const ageRank = new Map(requests.map((r, i) => [r.id, i]));
  const byCategory = new Map<string, OfferingPlacement[]>();
  for (const pl of placements) {
    const list = byCategory.get(pl.offering.categoryId) ?? [];
    list.push(pl);
    byCategory.set(pl.offering.categoryId, list);
  }

  const options = new Map<string, LearnerOption[]>();
  const unmatched: AssignmentOutcome['unmatched'] = [];
  for (const req of requests) {
    const opts: LearnerOption[] = [];
    for (const pl of byCategory.get(req.categoryId) ?? []) {
      const fit = learnerFit(ctx, req, pl);
      if (fit.feasible) opts.push({ placement: pl, score: fit.score, distanceKm: fit.distanceKm });
    }
    opts.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm || a.placement.offering.id.localeCompare(b.placement.offering.id));
    if (opts.length > 0) options.set(req.id, opts);
    else unmatched.push({ request: req, reason: unmatchedReason(ctx, req, placements) });
  }

  const seated = new Map<string, LearnerOption>();
  for (const [categoryId, pls] of byCategory) {
    const learners = requests.filter((r) => r.categoryId === categoryId && options.has(r.id));
    if (learners.length === 0) continue;
    const L = learners.length;
    const S = 0;
    const T = 1;
    const plIndex = new Map(pls.map((p, i) => [p.offering.id, 2 + L + i]));
    const flow = new MinCostFlow(2 + L + pls.length);
    const multiplier = (L * (L + 1)) / 2 + 1;
    const edges: { req: EngineRequest; opt: LearnerOption; edge: number }[] = [];
    learners.forEach((req, li) => {
      flow.addEdge(S, 2 + li, 1, 0);
      const rank = li; // learners are already oldest first
      for (const opt of options.get(req.id) ?? []) {
        const to = plIndex.get(opt.placement.offering.id);
        if (to === undefined) continue;
        const base = Math.round((1 - opt.score) * 1000);
        edges.push({ req, opt, edge: flow.addEdge(2 + li, to, 1, base * multiplier + rank) });
      }
    });
    pls.forEach((pl, i) => flow.addEdge(2 + L + i, T, Math.max(0, pl.seats), 0));
    flow.run(S, T);
    for (const e of edges) if (flow.flowOn(e.edge) > 0) seated.set(e.req.id, e.opt);
  }

  const assignments: LearnerAssignment[] = [];
  const waitlists = new Map<string, LearnerAssignment[]>();
  for (const req of requests) {
    const opts = options.get(req.id);
    if (!opts) continue;
    const seat = seated.get(req.id);
    const chosen = seat ?? opts[0];
    if (!chosen) continue;
    const second = opts.find((o) => o.placement.offering.id !== chosen.placement.offering.id) ?? null;
    const a: LearnerAssignment = {
      requestId: req.id,
      offeringId: chosen.placement.offering.id,
      spaceId: chosen.placement.space.id,
      kind: seat ? 'seat' : 'waitlist',
      score: chosen.score,
      distanceKm: Math.round(chosen.distanceKm * 100) / 100,
      waitlistRank: null,
      secondBest: second ? { offeringId: second.placement.offering.id, score: second.score } : null,
    };
    assignments.push(a);
    if (!seat) {
      const list = waitlists.get(a.offeringId) ?? [];
      list.push(a);
      waitlists.set(a.offeringId, list);
    }
  }
  for (const list of waitlists.values()) {
    list
      .sort((a, b) => b.score - a.score || (ageRank.get(a.requestId) ?? 0) - (ageRank.get(b.requestId) ?? 0))
      .forEach((a, i) => (a.waitlistRank = i + 1));
  }
  return { assignments, unmatched, options };
}
