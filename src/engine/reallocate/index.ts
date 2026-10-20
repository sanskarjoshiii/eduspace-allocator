import { buildSlotNodes, placeGivenSession } from '../constraints/candidates';
import { evaluateConstraints } from '../constraints/check';
import { type EngineContext, centreDistance } from '../context';
import { rankNodesForOffering, toProposedAllocation } from '../matching/edges';
import { CONSTRAINT_LABEL, type RecheckResult, type TimeWindow } from '../types';
import { containsWindow } from '../util/time';

export interface BookedAllocation {
  allocationId: string;
  offeringId: string;
  spaceId: string;
  session: TimeWindow;
}

const MAX_ALTERNATIVES = 3;

/**
 * Re-checks booked allocations against the current snapshot (README 13.9). The
 * allocation's own session is ignored when checking clashes. Failing allocations get up
 * to three feasible alternatives on other spaces or sessions, best first.
 */
export function recheck(ctx: EngineContext, allocations: readonly BookedAllocation[]): RecheckResult[] {
  let nodes: ReturnType<typeof buildSlotNodes> | null = null;
  return allocations.map((a) => {
    const offering = ctx.offeringById.get(a.offeringId);
    if (!offering) {
      return { allocationId: a.allocationId, stillFeasible: false, failedConstraint: null, reason: 'The offering is no longer open', alternatives: [] };
    }
    const space = ctx.spaceById.get(a.spaceId);
    let failedConstraint: RecheckResult['failedConstraint'];
    let reason: string;
    if (!space) {
      failedConstraint = 'active';
      reason = `${CONSTRAINT_LABEL.active}: the space is no longer listed`;
    } else {
      const { slot, placement } = placeGivenSession(ctx, space, offering, a.session, a.session);
      const ev = evaluateConstraints(ctx, { space, offering, slot, placement, distance: centreDistance(ctx, offering, space.location) });
      if (ev.firstFailure === null) {
        return { allocationId: a.allocationId, stillFeasible: true, failedConstraint: null, reason: 'All constraints still pass', alternatives: [] };
      }
      failedConstraint = ev.firstFailure;
      const detail = ev.results.find((r) => r.constraint === ev.firstFailure)?.detail ?? '';
      reason = `${CONSTRAINT_LABEL[ev.firstFailure]}: ${detail}`;
    }
    nodes ??= buildSlotNodes(ctx);
    const alternatives = rankNodesForOffering(ctx, offering, nodes, (n) => n.spaceId === a.spaceId && containsWindow(n.free, a.session))
      .slice(0, MAX_ALTERNATIVES)
      .map((c) => toProposedAllocation(ctx, c));
    return { allocationId: a.allocationId, stillFeasible: false, failedConstraint, reason, alternatives };
  });
}
