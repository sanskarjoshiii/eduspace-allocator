import { buildSlotNodes } from './constraints/candidates';
import { type EngineContext, buildContext } from './context';
import { runBaseline } from './evaluate/baseline';
import { buildInsights } from './evaluate/insights';
import { computeMetrics } from './evaluate/metrics';
import { ownerLookup, rejectedAlternatives } from './explain/alternatives';
import { assignLearners } from './flow/assign';
import { type OfferingPlacement, fixedPlacements } from './flow/fit';
import { buildPairCandidates, toProposedAllocation } from './matching/edges';
import { matchSpaces } from './matching/space-matching';
import { suggestTargets, suggestionsFor } from './suggest';
import type { EngineSettings, EngineSnapshot, PipelineResult, ProposedAllocation, TimeWindow } from './types';

export type PhaseTimings = Record<string, number>;

export interface DetailedPipelineResult {
  result: PipelineResult;
  ctx: EngineContext;
  placements: OfferingPlacement[];
  /** Milliseconds per phase (reporting only). */
  timings: PhaseTimings;
}

/** Runs the full pipeline and also returns the context, placements and phase timings. */
export function runPipelineDetailed(snapshot: EngineSnapshot, settings: EngineSettings): DetailedPipelineResult {
  const timings: PhaseTimings = {};
  const start = performance.now();
  let mark = start;
  const lap = (name: string): void => {
    const now = performance.now();
    timings[name] = Math.round((now - mark) * 10) / 10;
    mark = now;
  };

  // 1–3. Prepare, demand clustering, cohorts.
  const ctx = buildContext(snapshot, settings);
  lap('demand+cohorts');

  // 4–5. Candidates and scores.
  const nodes = buildSlotNodes(ctx);
  const needing = snapshot.offerings.filter((o) => !o.fixed);
  const candidates = buildPairCandidates(ctx, needing, nodes);
  lap('candidates+scoring');

  // 6. Space matching.
  const matched = matchSpaces(candidates, settings);
  lap('matching');

  // 8 (part). Explanations for each allocation.
  const owners = new Map<string, { free: TimeWindow; offeringId: string }[]>();
  for (const c of matched) {
    if (!c) continue;
    const list = owners.get(c.space.id) ?? [];
    list.push({ free: c.node.free, offeringId: c.offering.id });
    owners.set(c.space.id, list);
  }
  const takenBy = ownerLookup(owners);
  const allocations: ProposedAllocation[] = [];
  const costScores: number[] = [];
  for (const c of matched) {
    if (!c) continue;
    const alloc = toProposedAllocation(ctx, c);
    alloc.rejectedAlternatives = rejectedAlternatives(ctx, c.offering, { spaceId: c.space.id, score: c.score }, takenBy, settings.alternativesToKeep);
    allocations.push(alloc);
    costScores.push(c.costScore);
  }
  lap('explain');

  // 7. Learner assignment.
  const placements: OfferingPlacement[] = [
    ...matched.flatMap((c) =>
      c ? [{ offering: c.offering, space: c.space, session: c.placement.session, seats: c.offering.batchSize, fixed: false }] : [],
    ),
    ...fixedPlacements(ctx),
  ];
  const outcome = assignLearners(ctx, placements);
  lap('learner-flow');

  const targets = suggestTargets(ctx, placements);
  const unmatched = outcome.unmatched.map((u) => ({
    requestId: u.request.id,
    reason: u.reason,
    suggestions: suggestionsFor(ctx, u.request, targets, settings.suggestionCount),
  }));
  const insights = buildInsights(ctx, placements);
  lap('suggestions+insights');

  const seats = outcome.assignments.filter((a) => a.kind === 'seat');
  const metrics = computeMetrics(ctx, {
    allocations: allocations.map((a, i) => ({ score: a.score, costScore: costScores[i] ?? 0, session: a.session })),
    placements,
    seatDistancesKm: seats.map((a) => a.distanceKm),
    waitlisted: outcome.assignments.length - seats.length,
    unmatched: unmatched.length,
    runTimeMs: performance.now() - start,
  });
  const baselineMetrics = runBaseline(ctx, candidates);
  lap('baseline');

  return {
    result: {
      allocations,
      assignments: outcome.assignments,
      unmatched,
      areaDemand: ctx.areaDemand,
      insights,
      cohorts: ctx.cohorts,
      metrics,
      baselineMetrics,
      k: ctx.k,
      silhouette: ctx.silhouette,
    },
    ctx,
    placements,
    timings,
  };
}

/** Smart Allocation pipeline (README 13.2): pure and deterministic for a given snapshot and seed. */
export function runPipeline(snapshot: EngineSnapshot, settings: EngineSettings): PipelineResult {
  return runPipelineDetailed(snapshot, settings).result;
}
