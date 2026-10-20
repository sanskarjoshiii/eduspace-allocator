import { describe, expect, it } from 'vitest';
import { engine, recheckAllocations, runPipeline, suggestFor } from '@/engine';
import type { EngineSnapshot, PipelineResult } from '@/engine/types';
import { overlapMinutes } from '@/engine/util/time';
import { SAT, hm, settings, southPuneSnapshot, win } from './fixtures';

function stripTimes(r: PipelineResult): PipelineResult {
  return { ...r, metrics: { ...r.metrics, runTimeMs: 0 }, baselineMetrics: { ...r.baselineMetrics, runTimeMs: 0 } };
}

describe('runPipeline: weekend coding classes in South Pune', () => {
  const snap = southPuneSnapshot();
  const result = runPipeline(snap, settings());

  it('allocates every offering to a feasible, conflict-free space', () => {
    expect(result.allocations).toHaveLength(3);
    const bySpace = new Map(result.allocations.map((a) => [a.offeringId, a.spaceId]));
    expect(bySpace.get('o-music')).toBe('s-sinhagad-library');
    expect(bySpace.get('o-coding-a')).not.toBe('s-closed-hall');
    expect(bySpace.get('o-coding-b')).not.toBe('s-closed-hall');
    for (const a of result.allocations) {
      expect(a.constraints).toHaveLength(7);
      expect(a.constraints.every((c) => c.passed)).toBe(true);
      expect(a.breakdown).toHaveLength(7);
      expect(a.score).toBeGreaterThan(0);
      expect(a.score).toBeLessThanOrEqual(1);
      expect(a.rejectedAlternatives.length).toBeLessThanOrEqual(3);
      expect(a.session.end - a.session.start).toBe(snap.offerings.find((o) => o.id === a.offeringId)!.sessionMinutes);
    }
    for (const a of result.allocations)
      for (const b of result.allocations)
        if (a !== b && a.spaceId === b.spaceId) expect(overlapMinutes(a.session, b.session)).toBe(0);
  });

  it('explains why the closed hall lost', () => {
    const codingA = result.allocations.find((a) => a.offeringId === 'o-coding-a')!;
    const closed = codingA.rejectedAlternatives.find((r) => r.spaceId === 's-closed-hall');
    expect(closed?.failedConstraint).toBe('active');
    expect(closed?.reason).toContain('Closed Hall is not active');
  });

  it('respects seat limits and waitlists the overflow', () => {
    for (const o of snap.offerings) {
      const seats = result.assignments.filter((a) => a.offeringId === o.id && a.kind === 'seat').length;
      expect(seats).toBeLessThanOrEqual(o.batchSize);
    }
    const coding = result.assignments.filter((a) => a.offeringId.startsWith('o-coding'));
    expect(coding.filter((a) => a.kind === 'seat')).toHaveLength(22);
    const wait = coding.filter((a) => a.kind === 'waitlist');
    expect(wait).toHaveLength(1);
    expect(wait[0]!.waitlistRank).toBe(1);
    expect(wait[0]!.secondBest).not.toBeNull();
    expect(result.assignments.filter((a) => a.offeringId === 'o-music' && a.kind === 'seat')).toHaveLength(4);
  });

  it('accounts for every request exactly once', () => {
    const ids = [...result.assignments.map((a) => a.requestId), ...result.unmatched.map((u) => u.requestId)].sort();
    expect(ids).toEqual(snap.requests.map((r) => r.id).sort());
  });

  it('gives unmatched learners reasons and ranked suggestions', () => {
    const robotics = result.unmatched.find((u) => u.requestId === 'robotics-0')!;
    expect(robotics.reason).toBe('No open Robotics offering yet');
    expect(robotics.suggestions.length).toBeGreaterThan(0);
    expect(robotics.suggestions.length).toBeLessThanOrEqual(3);
    const first = robotics.suggestions[0]!;
    expect(first.categoryId).toBe('coding');
    expect(first.reasons).toContain('Same parent category: Technology');
    expect(first.reasons.some((r) => /^\d+\.\d km away$/.test(r))).toBe(true);
    const sorted = [...robotics.suggestions].sort((a, b) => b.score - a.score);
    expect(robotics.suggestions).toEqual(sorted);

    const adult = result.unmatched.find((u) => u.requestId === 'coding-adult')!;
    expect(adult.reason).toBe('No open Coding offering for Adults');
  });

  it('reports demand levels, insights, cohorts and metrics', () => {
    expect(result.areaDemand.map((a) => a.areaId).sort()).toEqual(['bibwewadi', 'katraj', 'sinhagad']);
    expect(result.k).toBe(2);
    const katrajCoding = result.insights.find((r) => r.areaId === 'katraj' && r.categoryId === 'coding')!;
    expect(katrajCoding.demand).toBe(13 + 5); // 12 teens + 1 adult in Katraj, baseline 5
    expect(katrajCoding.gap).toBe(katrajCoding.demand - katrajCoding.seatsOffered);
    expect(result.cohorts.every((c) => c.requestIds.length <= 15)).toBe(true);
    const m = result.metrics;
    expect(m.requests).toBe(30);
    expect(m.assigned + m.waitlisted + m.unmatched).toBe(30);
    expect(m.coverageRate).toBeCloseTo(26 / 30, 4);
    expect(m.allocations).toBe(3);
    expect(m.optimisationScore).toBeGreaterThan(0);
    expect(m.optimisationScore).toBeLessThanOrEqual(1);
    expect(m.avgScore).toBeGreaterThanOrEqual(result.baselineMetrics.avgScore);
  });

  it('is deterministic', () => {
    expect(stripTimes(runPipeline(southPuneSnapshot(), settings()))).toEqual(stripTimes(result));
    expect(stripTimes(engine.runPipeline(southPuneSnapshot(), settings()))).toEqual(stripTimes(result));
  });
});

describe('recheckAllocations', () => {
  function withFixed(): EngineSnapshot {
    const snap = southPuneSnapshot();
    const session = win(SAT, hm(10), hm(12));
    const spaces = snap.spaces.map((s) =>
      s.id === 's-katraj-hall'
        ? { ...s, bookings: [session], facilities: [{ facilityTypeId: 'computer', quantity: 26, workingQuantity: 5 }] }
        : s,
    );
    const offerings = snap.offerings.map((o) =>
      o.id === 'o-coding-a' ? { ...o, fixed: { allocationId: 'alloc-1', spaceId: 's-katraj-hall', session, seatsTaken: 10 } } : o,
    );
    return { ...snap, spaces, offerings };
  }

  it('flags an allocation whose computers broke and proposes alternatives elsewhere', () => {
    const [res] = recheckAllocations(withFixed(), settings(), [
      { allocationId: 'alloc-1', offeringId: 'o-coding-a', spaceId: 's-katraj-hall', session: win(SAT, hm(10), hm(12)) },
    ]);
    expect(res!.stillFeasible).toBe(false);
    expect(res!.failedConstraint).toBe('facilities');
    expect(res!.reason).toBe('Facilities: 5 working computers, the course needs 12');
    expect(res!.alternatives.length).toBeGreaterThan(0);
    expect(res!.alternatives.length).toBeLessThanOrEqual(3);
    expect(res!.alternatives[0]!.spaceId).toBe('s-bibwewadi-lab');
    expect(res!.alternatives.every((a) => a.constraints.every((c) => c.passed))).toBe(true);
  });

  it('keeps a still-feasible allocation, ignoring its own booking', () => {
    const snap = withFixed();
    snap.spaces = snap.spaces.map((s) =>
      s.id === 's-katraj-hall' ? { ...s, facilities: [{ facilityTypeId: 'computer', quantity: 26, workingQuantity: 20 }] } : s,
    );
    const [res] = recheckAllocations(snap, settings(), [
      { allocationId: 'alloc-1', offeringId: 'o-coding-a', spaceId: 's-katraj-hall', session: win(SAT, hm(10), hm(12)) },
    ]);
    expect(res).toMatchObject({ stillFeasible: true, failedConstraint: null, alternatives: [] });
  });
});

describe('suggestFor', () => {
  it('returns ranked suggestions for one request and [] for an unknown id', () => {
    const s = suggestFor(southPuneSnapshot(), settings(), 'robotics-1');
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]!.reasons[0]).toBe('Same parent category: Technology');
    expect(suggestFor(southPuneSnapshot(), settings(), 'nope')).toEqual([]);
  });
});
