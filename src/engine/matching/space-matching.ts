import type { EngineSettings } from '../types';
import type { PairCandidate } from './edges';
import { type MatchEdge, maxWeightMatching } from './hungarian';

/**
 * Space matching (README 13.6): maximum-weight bipartite matching between offerings and
 * free sub-window nodes, using only feasible edges scoring at least `minEdgeScore`.
 * Each node is used at most once, so allocations in one run never share a slot.
 * Returns the chosen candidate per offering (same order as `candidates`) or null.
 */
export function matchSpaces(candidates: readonly PairCandidate[][], settings: EngineSettings): (PairCandidate | null)[] {
  const rightIndex = new Map<number, number>();
  const edges: MatchEdge[] = [];
  const lookup = new Map<string, PairCandidate>();
  candidates.forEach((list, left) => {
    for (const c of list) {
      if (c.score < settings.minEdgeScore) continue;
      let right = rightIndex.get(c.node.index);
      if (right === undefined) {
        right = rightIndex.size;
        rightIndex.set(c.node.index, right);
      }
      edges.push({ left, right, weight: c.score });
      lookup.set(`${left}:${right}`, c);
    }
  });
  const match = maxWeightMatching(candidates.length, rightIndex.size, edges);
  return match.map((right, left) => (right >= 0 ? (lookup.get(`${left}:${right}`) ?? null) : null));
}
