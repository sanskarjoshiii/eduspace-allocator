import type { EngineContext } from '../context';
import type { OfferingPlacement } from '../flow/fit';
import type { RunMetrics, TimeWindow } from '../types';
import { clamp01, round4 } from '../util/format';
import { windowMinutes } from '../util/time';

export interface MetricsInput {
  /** Newly proposed allocations of the run. */
  allocations: { score: number; costScore: number; session: TimeWindow }[];
  /** Every offering with a space this run, fixed ones included. */
  placements: readonly OfferingPlacement[];
  /** Distances of learners given a seat. */
  seatDistancesKm: number[];
  waitlisted: number;
  unmatched: number;
  runTimeMs: number;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Run metrics (README 13.10). optimisationScore = 0.4 avgScore + 0.2 seat use + 0.2 cost efficiency + 0.2 coverage. */
export function computeMetrics(ctx: EngineContext, input: MetricsInput): RunMetrics {
  const requests = ctx.snapshot.requests.length;
  const assigned = input.seatDistancesKm.length;
  let offered = 0;
  let filled = assigned;
  for (const p of input.placements) {
    offered += p.offering.batchSize;
    if (p.fixed) filled += p.offering.fixed?.seatsTaken ?? 0;
  }
  let bookedMinutes = 0;
  for (const list of ctx.bookingsBySpace.values()) for (const b of list) bookedMinutes += windowMinutes(b);
  for (const a of input.allocations) bookedMinutes += windowMinutes(a.session);

  const coverageRate = requests > 0 ? assigned / requests : 0;
  const seatUtilisation = offered > 0 ? clamp01(filled / offered) : 0;
  const avgScore = mean(input.allocations.map((a) => a.score));
  const costEfficiency = mean(input.allocations.map((a) => a.costScore));
  return {
    requests,
    assigned,
    waitlisted: input.waitlisted,
    unmatched: input.unmatched,
    allocations: input.allocations.length,
    coverageRate: round4(coverageRate),
    avgDistanceKm: round4(mean(input.seatDistancesKm)),
    seatUtilisation: round4(seatUtilisation),
    spaceUtilisationHours: round4(bookedMinutes / 60),
    avgScore: round4(avgScore),
    waitlistRate: round4(requests > 0 ? input.waitlisted / requests : 0),
    optimisationScore: round4(0.4 * avgScore + 0.2 * seatUtilisation + 0.2 * costEfficiency + 0.2 * coverageRate),
    runTimeMs: Math.round(input.runTimeMs * 10) / 10,
  };
}
