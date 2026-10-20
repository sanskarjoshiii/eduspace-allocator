import { type Placement, type SlotNode, placeInFreeWindow } from '../constraints/candidates';
import { evaluateConstraints, isFeasible } from '../constraints/check';
import { type CentreDistance, type EngineContext, centreDistance } from '../context';
import { scorePair } from '../scoring';
import type { EngineOffering, EngineSpace, ProposedAllocation, ScoreBreakdown } from '../types';
import { round4 } from '../util/format';

/** A feasible (offering, free sub-window) pair with its placed session and score. */
export interface PairCandidate {
  offering: EngineOffering;
  space: EngineSpace;
  node: SlotNode;
  placement: Extract<Placement, { ok: true }>;
  distance: CentreDistance | null;
  score: number;
  costScore: number;
  breakdown: ScoreBreakdown[];
}

/** Evaluates one node for an offering; returns the candidate when every constraint passes. */
export function evaluateNode(
  ctx: EngineContext,
  offering: EngineOffering,
  space: EngineSpace,
  node: SlotNode,
  distance: CentreDistance | null,
): PairCandidate | null {
  const placement = placeInFreeWindow(node.free, offering);
  if (!placement.ok) return null;
  if (!isFeasible(ctx, { space, offering, slot: node.slot, placement, distance })) return null;
  const s = scorePair(ctx, space, offering, placement.overlap, distance);
  return { offering, space, node, placement, distance, score: s.score, costScore: s.costScore, breakdown: s.breakdown };
}

/**
 * Feasible candidates per offering (same order as `offerings`). A geo prefilter skips
 * spaces farther than the radius from the demand centre before any slot is examined.
 */
export function buildPairCandidates(ctx: EngineContext, offerings: readonly EngineOffering[], nodes: readonly SlotNode[]): PairCandidate[][] {
  const nodesBySpace = new Map<string, SlotNode[]>();
  for (const n of nodes) {
    const list = nodesBySpace.get(n.spaceId) ?? [];
    list.push(n);
    nodesBySpace.set(n.spaceId, list);
  }
  const maxR = ctx.settings.maxRadiusKm;
  return offerings.map((offering) => {
    const out: PairCandidate[] = [];
    for (const [spaceId, spaceNodes] of nodesBySpace) {
      const space = ctx.spaceById.get(spaceId);
      if (!space) continue;
      const distance = centreDistance(ctx, offering, space.location);
      if (distance && distance.km > maxR) continue;
      for (const node of spaceNodes) {
        const c = evaluateNode(ctx, offering, space, node, distance);
        if (c) out.push(c);
      }
    }
    return out;
  });
}

/** Turns a chosen candidate into a ProposedAllocation (constraints all pass, with details). */
export function toProposedAllocation(ctx: EngineContext, c: PairCandidate): ProposedAllocation {
  const ev = evaluateConstraints(ctx, {
    space: c.space,
    offering: c.offering,
    slot: c.node.slot,
    placement: c.placement,
    distance: c.distance,
  });
  return {
    offeringId: c.offering.id,
    spaceId: c.space.id,
    session: c.placement.session,
    score: c.score,
    distanceKm: round4(c.distance?.km ?? 0),
    breakdown: c.breakdown,
    constraints: ev.results,
    rejectedAlternatives: [],
  };
}

/** Candidates for one offering across all nodes, best first (used by re-checks). */
export function rankNodesForOffering(
  ctx: EngineContext,
  offering: EngineOffering,
  nodes: readonly SlotNode[],
  exclude?: (node: SlotNode) => boolean,
): PairCandidate[] {
  const [list = []] = buildPairCandidates(ctx, [offering], exclude ? nodes.filter((n) => !exclude(n)) : nodes);
  return list.sort((a, b) => b.score - a.score || (a.distance?.km ?? 0) - (b.distance?.km ?? 0) || a.node.index - b.node.index);
}
