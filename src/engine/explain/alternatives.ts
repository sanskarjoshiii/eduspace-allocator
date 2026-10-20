import { freeWindows, placeInFreeWindow, type Placement, type Slot } from '../constraints/candidates';
import { evaluateConstraints } from '../constraints/check';
import { type EngineContext, centreDistance } from '../context';
import { scorePair } from '../scoring';
import { CONSTRAINT_LABEL, CONSTRAINT_ORDER, type ConstraintName, type EngineOffering, type EngineSpace, type RejectedAlternative, type TimeWindow } from '../types';
import { formatScore, round4 } from '../util/format';
import { formatWindow, sameWindow } from '../util/time';

/** Best evaluation of one space for an offering: highest feasible score, else the furthest-reaching failure. */
export interface SpaceEvaluation {
  space: EngineSpace;
  session: TimeWindow | null;
  failedConstraint: ConstraintName | null;
  failDetail: string;
  score: number | null;
  distanceKm: number | null;
  /** Free sub-window the session sits in (feasible only). */
  free: TimeWindow | null;
}

/** Evaluates every slot (and free sub-window) of a space for an offering. */
export function evaluateSpace(ctx: EngineContext, space: EngineSpace, offering: EngineOffering): SpaceEvaluation {
  const distance = centreDistance(ctx, offering, space.location);
  const distanceKm = distance ? round4(distance.km) : null;
  const candidates: SpaceEvaluation[] = [];
  const consider = (slot: Slot | null, placement: Placement, free: TimeWindow | null): void => {
    const ev = evaluateConstraints(ctx, { space, offering, slot, placement, distance });
    let cand: SpaceEvaluation;
    if (ev.firstFailure === null && placement.ok) {
      const s = scorePair(ctx, space, offering, placement.overlap, distance);
      cand = { space, session: placement.session, failedConstraint: null, failDetail: '', score: s.score, distanceKm, free };
    } else {
      const failed = ev.firstFailure ?? 'time';
      const detail = ev.results.find((r) => r.constraint === failed)?.detail ?? CONSTRAINT_LABEL[failed];
      cand = { space, session: placement.session, failedConstraint: failed, failDetail: detail, score: null, distanceKm, free };
    }
    candidates.push(cand);
  };

  if (space.slots.length === 0) {
    consider(null, { ok: false, session: null, overlap: 0, detail: 'No weekly slots listed' }, null);
  }
  for (const slot of space.slots) {
    if (!space.isActive || slot.isBlocked) {
      consider(slot, { ok: false, session: null, overlap: 0, detail: 'Slot not open' }, null);
      continue;
    }
    const frees = freeWindows(ctx, space, slot);
    if (frees.length === 0) {
      consider(slot, { ok: false, session: null, overlap: 0, detail: `Slot ${formatWindow(slot)} is fully booked` }, null);
    }
    for (const free of frees) consider(slot, placeInFreeWindow(free, offering), free);
  }
  let best = candidates[0];
  if (!best) throw new Error('unreachable: space evaluation produced no candidate');
  for (const c of candidates) if (better(c, best)) best = c;
  return best;
}

function progress(e: SpaceEvaluation): number {
  return e.failedConstraint === null ? CONSTRAINT_ORDER.length : CONSTRAINT_ORDER.indexOf(e.failedConstraint);
}

function better(a: SpaceEvaluation, b: SpaceEvaluation): boolean {
  const pa = progress(a);
  const pb = progress(b);
  if (pa !== pb) return pa > pb;
  return (a.score ?? 0) > (b.score ?? 0);
}

/**
 * The closest rejected alternatives for an allocation (README 13.7): the nearest other
 * spaces, each with its first failed constraint, or its score when feasible but not chosen.
 */
export function rejectedAlternatives(
  ctx: EngineContext,
  offering: EngineOffering,
  chosen: { spaceId: string; score: number },
  takenBy: (spaceId: string, free: TimeWindow) => string | null,
  limit: number,
): RejectedAlternative[] {
  if (limit <= 0) return [];
  const ranked = ctx.snapshot.spaces
    .filter((s) => s.id !== chosen.spaceId)
    .map((s) => ({ s, d: centreDistance(ctx, offering, s.location)?.km ?? Infinity }))
    .sort((a, b) => a.d - b.d || a.s.id.localeCompare(b.s.id))
    .slice(0, limit);
  return ranked.map(({ s }) => {
    const ev = evaluateSpace(ctx, s, offering);
    let reason: string;
    // Show a third decimal when two decimals would make different scores look equal.
    const fmtPair = (a: number, b: number): [string, string] =>
      formatScore(a) === formatScore(b) && a !== b ? [a.toFixed(3), b.toFixed(3)] : [formatScore(a), formatScore(b)];
    if (ev.failedConstraint !== null) {
      reason = `${CONSTRAINT_LABEL[ev.failedConstraint]}: ${ev.failDetail}`;
    } else {
      const score = ev.score ?? 0;
      const owner = ev.free ? takenBy(s.id, ev.free) : null;
      const [mine, theirs] = fmtPair(score, chosen.score);
      if (score < ctx.settings.minEdgeScore) {
        reason = `Scored ${formatScore(score)}, below the minimum ${formatScore(ctx.settings.minEdgeScore)}`;
      } else if (owner !== null && owner !== offering.id) {
        reason = `Scored ${mine} against ${theirs}; that time went to another course for a better overall plan`;
      } else if (score <= chosen.score) {
        reason = `Scored ${mine} against ${theirs}`;
      } else {
        reason = `Scored ${mine} against ${theirs}; the overall plan scores higher this way`;
      }
    }
    return {
      spaceId: s.id,
      spaceName: s.name,
      session: ev.session,
      failedConstraint: ev.failedConstraint,
      reason,
      score: ev.score,
      distanceKm: ev.distanceKm,
    };
  });
}

/** Helper for `takenBy`: finds the offering whose session sits in the given free window. */
export function ownerLookup(byNode: Map<string, { free: TimeWindow; offeringId: string }[]>) {
  return (spaceId: string, free: TimeWindow): string | null =>
    byNode.get(spaceId)?.find((x) => sameWindow(x.free, free))?.offeringId ?? null;
}
