import { describe, expect, it } from 'vitest';
import { buildSlotNodes } from '@/engine/constraints/candidates';
import { buildContext } from '@/engine/context';
import { assignLearners } from '@/engine/flow/assign';
import { type OfferingPlacement } from '@/engine/flow/fit';
import { MinCostFlow } from '@/engine/flow/mincost';
import { buildPairCandidates } from '@/engine/matching/edges';
import { type MatchEdge, greedyMatching, matchingWeight, maxWeightMatching } from '@/engine/matching/hungarian';
import { mulberry32 } from '@/engine/util/prng';
import { SAT, baseSnapshot, hm, offering, request, settings, southPuneSnapshot, space, win } from './fixtures';

describe('scoring', () => {
  it('keeps every sub-score and the total in [0, 1] with weights from settings', () => {
    const snap = southPuneSnapshot();
    const ctx = buildContext(snap, settings());
    const cands = buildPairCandidates(ctx, snap.offerings, buildSlotNodes(ctx)).flat();
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
      expect(c.breakdown).toHaveLength(7);
      let sum = 0;
      for (const b of c.breakdown) {
        expect(b.score).toBeGreaterThanOrEqual(0);
        expect(b.score).toBeLessThanOrEqual(1);
        expect(b.weight).toBe(ctx.settings.weights[b.criterion]);
        expect(b.detail.length).toBeGreaterThan(0);
        sum += b.score * b.weight;
      }
      expect(c.score).toBeCloseTo(sum, 3);
    }
  });

  it('prefers a closer, cheaper, better-fitting space', () => {
    const near = space({ id: 'near', location: { lng: 73.857, lat: 18.452 }, seatCapacity: 14, facilities: [{ facilityTypeId: 'computer', quantity: 14, workingQuantity: 14 }] });
    const far = space({
      id: 'far',
      location: { lng: 73.857, lat: 18.482 },
      seatCapacity: 40,
      facilities: [{ facilityTypeId: 'computer', quantity: 14, workingQuantity: 14 }],
      policy: { allowedCategoryIds: [], allowedAudiences: [], rentPerHour: 440, approvalMode: 'auto' },
    });
    const snap = baseSnapshot({ spaces: [near, far], offerings: [offering({ id: 'o' })], requests: [request({ id: 'r' })] });
    const ctx = buildContext(snap, settings());
    const [list = []] = buildPairCandidates(ctx, snap.offerings, buildSlotNodes(ctx));
    const byId = new Map(list.map((c) => [c.space.id, c.score]));
    expect(byId.get('near')!).toBeGreaterThan(byId.get('far')!);
  });
});

describe('maxWeightMatching (Hungarian)', () => {
  it('beats greedy best-first on a crafted counter-example', () => {
    // Greedy takes A-X (0.9) then is left with B-Y (0.1) = 1.0; optimum A-Y + B-X = 1.65.
    const edges: MatchEdge[] = [
      { left: 0, right: 0, weight: 0.9 },
      { left: 0, right: 1, weight: 0.8 },
      { left: 1, right: 0, weight: 0.85 },
      { left: 1, right: 1, weight: 0.1 },
    ];
    const greedy = greedyMatching(2, 2, edges);
    const optimal = maxWeightMatching(2, 2, edges);
    expect(matchingWeight(greedy, edges)).toBeCloseTo(1.0, 10);
    expect(optimal).toEqual([1, 0]);
    expect(matchingWeight(optimal, edges)).toBeCloseTo(1.65, 10);
  });

  it('handles rectangular inputs and missing edges, never reusing a right node', () => {
    const edges: MatchEdge[] = [
      { left: 0, right: 2, weight: 0.5 },
      { left: 1, right: 2, weight: 0.6 },
      { left: 2, right: 0, weight: 0.3 },
    ];
    const m = maxWeightMatching(4, 3, edges);
    expect(m[1]).toBe(2);
    expect(m[0]).toBe(-1);
    expect(m[2]).toBe(0);
    expect(m[3]).toBe(-1);
  });

  it('equals brute force on random small instances', () => {
    const rand = mulberry32(9);
    for (let t = 0; t < 40; t++) {
      const n = 1 + Math.floor(rand() * 4);
      const m = 1 + Math.floor(rand() * 5);
      const edges: MatchEdge[] = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if (rand() < 0.6) edges.push({ left: i, right: j, weight: Math.round(rand() * 100) / 100 });
      const w = new Map(edges.map((e) => [`${e.left}:${e.right}`, e.weight]));
      let best = 0;
      const used = new Array<boolean>(m).fill(false);
      const rec = (i: number, acc: number): void => {
        if (i === n) {
          best = Math.max(best, acc);
          return;
        }
        rec(i + 1, acc);
        for (let j = 0; j < m; j++) {
          const wt = w.get(`${i}:${j}`);
          if (wt === undefined || used[j]) continue;
          used[j] = true;
          rec(i + 1, acc + wt);
          used[j] = false;
        }
      };
      rec(0, 0);
      const got = maxWeightMatching(n, m, edges);
      expect(new Set(got.filter((r) => r >= 0)).size).toBe(got.filter((r) => r >= 0).length);
      expect(matchingWeight(got, edges)).toBeCloseTo(best, 9);
    }
  });
});

describe('MinCostFlow', () => {
  it('finds the min-cost max flow on a small graph', () => {
    // s=0, a=1, b=2, t=3
    const f = new MinCostFlow(4);
    f.addEdge(0, 1, 2, 1);
    f.addEdge(0, 2, 1, 2);
    f.addEdge(1, 2, 1, 1);
    const e13 = f.addEdge(1, 3, 1, 3);
    f.addEdge(2, 3, 2, 1);
    const res = f.run(0, 3);
    expect(res.flow).toBe(3);
    // Paths: s-a-b-t (3), s-b-t (3), s-a-t (4) -> 10
    expect(res.cost).toBe(10);
    expect(f.flowOn(e13)).toBe(1);
  });
});

describe('assignLearners', () => {
  function scenario(nLearners: number, seats: number) {
    const sp = space({ id: 'hall', facilities: [{ facilityTypeId: 'computer', quantity: 30, workingQuantity: 30 }] });
    const of = offering({ id: 'o1', batchSize: seats });
    const reqs = Array.from({ length: nLearners }, (_, i) =>
      request({ id: `L${String(i).padStart(2, '0')}`, createdAt: `2026-10-01T10:00:${String(i).padStart(2, '0')}.000Z` }),
    );
    reqs.push(request({ id: 'adult', audience: 'Adults' }));
    const snap = baseSnapshot({ spaces: [sp], offerings: [of], requests: reqs });
    const ctx = buildContext(snap, settings());
    const pl: OfferingPlacement = { offering: of, space: sp, session: win(SAT, hm(10), hm(12)), seats, fixed: false };
    return { snap, out: assignLearners(ctx, [pl]) };
  }

  it('respects seat limits exactly and waitlists the overflow, older first on ties', () => {
    const { out } = scenario(15, 12);
    const seats = out.assignments.filter((a) => a.kind === 'seat');
    const wait = out.assignments.filter((a) => a.kind === 'waitlist');
    expect(seats).toHaveLength(12);
    expect(wait).toHaveLength(3);
    // Identical scores: the three newest requests wait, ranked oldest first.
    expect(wait.map((a) => [a.requestId, a.waitlistRank])).toEqual([
      ['L12', 1],
      ['L13', 2],
      ['L14', 3],
    ]);
  });

  it('assigns, waitlists or reports each learner exactly once', () => {
    const { snap, out } = scenario(15, 12);
    const seen = [...out.assignments.map((a) => a.requestId), ...out.unmatched.map((u) => u.request.id)].sort();
    expect(seen).toEqual(snap.requests.map((r) => r.id).sort());
    expect(out.unmatched.find((u) => u.request.id === 'adult')?.reason).toBe('No open Coding offering for Adults');
  });
});
