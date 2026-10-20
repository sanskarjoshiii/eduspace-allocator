import { buildContext } from './context';
import { runPipeline, runPipelineDetailed } from './pipeline';
import { type BookedAllocation, recheck } from './reallocate';
import { suggestTargets, suggestionsFor } from './suggest';
import type { EngineClient, EngineSettings, EngineSnapshot, RecheckResult, Suggestion } from './types';

/** Re-checks booked allocations after a facility change and proposes alternatives for failures. */
export function recheckAllocations(
  snapshot: EngineSnapshot,
  settings: EngineSettings,
  allocations: readonly BookedAllocation[],
): RecheckResult[] {
  return recheck(buildContext(snapshot, settings), allocations);
}

/**
 * Suggestions for one request, ranked as for unmatched learners (README 13.8). Runs the
 * pipeline so suggested offerings carry the space and session they would get. Returns []
 * for an unknown request.
 */
export function suggestFor(snapshot: EngineSnapshot, settings: EngineSettings, requestId: string): Suggestion[] {
  const { ctx, placements } = runPipelineDetailed(snapshot, settings);
  const req = ctx.requestById.get(requestId);
  if (!req) return [];
  return suggestionsFor(ctx, req, suggestTargets(ctx, placements), settings.suggestionCount);
}

export { runPipeline, runPipelineDetailed };

/** The engine behind the EngineClient interface (README 10: swappable for a remote service). */
export const engine: EngineClient = {
  runPipeline,
  recheckAllocations: (snapshot, settings, allocations) => recheckAllocations(snapshot, settings, allocations),
  suggestFor,
};

export type { BookedAllocation } from './reallocate';
export type { DetailedPipelineResult, PhaseTimings } from './pipeline';
export { haversineKm, projectKm, meanPoint } from './util/geo';
export { mulberry32 } from './util/prng';
export { formatWindow, formatClock, overlapMinutes, subtractWindows, windowMinutes } from './util/time';
export { formatKm, formatRupees } from './util/format';
export { StandardScaler, encodeIncomeGroup, silhouetteScore } from './kmeans/preprocess';
export { kmeans } from './kmeans/kmeans';
export { clusterAreas, labelClusters, demandIndex } from './kmeans/demand';
export { buildCohorts, targetBatchSize } from './kmeans/cohorts';
export { maxWeightMatching } from './matching/hungarian';
export { MinCostFlow } from './flow/mincost';
export { DEFAULT_WEIGHTS, STRATEGY_WEIGHTS, DEFAULT_SETTINGS, normaliseWeights } from './settings';
export * from './types';
