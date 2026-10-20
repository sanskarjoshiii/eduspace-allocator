// A small, deterministic first-fit implementation of the EngineClient contract.
// It is NOT the Smart Allocation engine (src/engine is): integration tests use it when
// they need exact, predictable outcomes (seat counts, waitlist order, clashes), so the
// orchestration can be verified independently of the optimiser's choices.

import type {
  ConstraintResult,
  EngineClient,
  EngineOffering,
  EngineSettings,
  EngineSnapshot,
  EngineSpace,
  LearnerAssignment,
  PipelineResult,
  ProposedAllocation,
  RecheckResult,
  RunMetrics,
  TimeWindow,
  UnmatchedRequest,
} from '@/engine/types';
import { haversineKm } from './snapshot';

const overlaps = (a: TimeWindow, b: TimeWindow) => a.dayOfWeek === b.dayOfWeek && a.start < b.end && b.start < a.end;

function facilitiesOk(space: EngineSpace, offering: EngineOffering): ConstraintResult {
  for (const r of offering.requirements) {
    const f = space.facilities.find((x) => x.facilityTypeId === r.facilityTypeId);
    const working = f?.workingQuantity ?? 0;
    if (working < r.minQuantity) {
      return { constraint: 'facilities', passed: false, detail: `${working} working against ${r.minQuantity} required` };
    }
  }
  return { constraint: 'facilities', passed: true, detail: 'All required facilities are working' };
}

function staticChecks(space: EngineSpace, offering: EngineOffering): ConstraintResult[] {
  const policyOk =
    (space.policy.allowedCategoryIds.length === 0 || space.policy.allowedCategoryIds.includes(offering.categoryId)) &&
    (space.policy.allowedAudiences.length === 0 || space.policy.allowedAudiences.includes(offering.audience));
  const budgetOk = offering.maxRentPerHour === null || space.policy.rentPerHour <= offering.maxRentPerHour;
  return [
    { constraint: 'active', passed: space.isActive, detail: space.isActive ? 'Space is active' : 'Space is inactive' },
    { constraint: 'capacity', passed: space.seatCapacity >= offering.batchSize, detail: `${space.seatCapacity} seats for a batch of ${offering.batchSize}` },
    facilitiesOk(space, offering),
    { constraint: 'policy', passed: policyOk, detail: policyOk ? 'Policy allows this course' : 'Policy does not allow this course' },
    { constraint: 'budget', passed: budgetOk, detail: budgetOk ? 'Rent within budget' : 'Rent above budget' },
  ];
}

/** First session window of `minutes` inside an open slot, inside the offering's windows, free of `taken`. */
function findSession(space: EngineSpace, offering: EngineOffering, taken: TimeWindow[]): TimeWindow | null {
  const slots = [...space.slots].filter((s) => !s.isBlocked).sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.start - b.start);
  for (const slot of slots) {
    const ranges = offering.windows.length
      ? offering.windows.filter((w) => w.dayOfWeek === slot.dayOfWeek).map((w) => ({ start: Math.max(w.start, slot.start), end: Math.min(w.end, slot.end) }))
      : [{ start: slot.start, end: slot.end }];
    for (const r of ranges) {
      for (let start = r.start; start + offering.sessionMinutes <= r.end; start += 30) {
        const cand: TimeWindow = { dayOfWeek: slot.dayOfWeek, start, end: start + offering.sessionMinutes };
        if (!taken.some((t) => overlaps(t, cand))) return cand;
      }
    }
  }
  return null;
}

function sessionFits(space: EngineSpace, session: TimeWindow, taken: TimeWindow[]): boolean {
  const inSlot = space.slots.some((s) => !s.isBlocked && s.dayOfWeek === session.dayOfWeek && s.start <= session.start && s.end >= session.end);
  return inSlot && !taken.some((t) => overlaps(t, session));
}

function proposal(offering: EngineOffering, space: EngineSpace, session: TimeWindow, distanceKm: number, constraints: ConstraintResult[]): ProposedAllocation {
  return {
    offeringId: offering.id,
    spaceId: space.id,
    session,
    score: 0.8,
    distanceKm,
    breakdown: [{ criterion: 'distance', score: 0.8, weight: 1, weighted: 0.8, detail: `${distanceKm.toFixed(1)} km` }],
    constraints: [...constraints, { constraint: 'time', passed: true, detail: 'Session fits an open slot' }],
    rejectedAlternatives: [],
  };
}

function emptyMetrics(): RunMetrics {
  return {
    requests: 0, assigned: 0, waitlisted: 0, unmatched: 0, allocations: 0, coverageRate: 0, avgDistanceKm: 0, seatUtilisation: 0,
    spaceUtilisationHours: 0, avgScore: 0, waitlistRate: 0, optimisationScore: 0, runTimeMs: 0,
  };
}

export const referenceEngine: EngineClient = {
  runPipeline(snapshot: EngineSnapshot, settings: EngineSettings): PipelineResult {
    const taken = new Map(snapshot.spaces.map((s) => [s.id, [...s.bookings]]));
    const spaces = [...snapshot.spaces].sort((a, b) => a.name.localeCompare(b.name));
    const areaById = new Map(snapshot.areas.map((a) => [a.id, a]));
    const allocations: ProposedAllocation[] = [];
    const placed = new Map<string, { spaceId: string; capacity: number }>();

    for (const o of [...snapshot.offerings].sort((a, b) => a.id.localeCompare(b.id))) {
      if (o.fixed) {
        placed.set(o.id, { spaceId: o.fixed.spaceId, capacity: Math.max(0, o.batchSize - o.fixed.seatsTaken) });
        continue;
      }
      for (const s of spaces) {
        const checks = staticChecks(s, o);
        if (checks.some((c) => !c.passed)) continue;
        const session = findSession(s, o, taken.get(s.id) ?? []);
        if (!session) continue;
        const centre = o.targetAreaId ? areaById.get(o.targetAreaId)?.center : undefined;
        const distanceKm = centre ? haversineKm(centre, s.location) : 0;
        if (centre && distanceKm > settings.maxRadiusKm) continue;
        allocations.push(proposal(o, s, session, distanceKm, checks));
        taken.get(s.id)!.push(session);
        placed.set(o.id, { spaceId: s.id, capacity: o.batchSize });
        break;
      }
    }

    const spaceById = new Map(snapshot.spaces.map((s) => [s.id, s]));
    const offeringById = new Map(snapshot.offerings.map((o) => [o.id, o]));
    const assignments: LearnerAssignment[] = [];
    const unmatched: UnmatchedRequest[] = [];
    const waitRank = new Map<string, number>();
    const requests = [...snapshot.requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const r of requests) {
      const feasible = [...placed.entries()]
        .filter(([oid, p]) => {
          const o = offeringById.get(oid)!;
          const sp = spaceById.get(p.spaceId);
          if (!sp || o.categoryId !== r.categoryId) return false;
          return haversineKm(r.location, sp.location) <= Math.min(r.maxDistanceKm, settings.maxRadiusKm);
        })
        .sort((a, b) => a[0].localeCompare(b[0]));
      const withSeat = feasible.find(([, p]) => p.capacity > 0);
      if (withSeat) {
        const [oid, p] = withSeat;
        p.capacity -= 1;
        const d = haversineKm(r.location, spaceById.get(p.spaceId)!.location);
        assignments.push({ requestId: r.id, offeringId: oid, spaceId: p.spaceId, kind: 'seat', score: 0.8, distanceKm: d, waitlistRank: null, secondBest: null });
      } else if (feasible.length > 0) {
        const [oid, p] = feasible[0]!;
        const rank = (waitRank.get(oid) ?? 0) + 1;
        waitRank.set(oid, rank);
        const d = haversineKm(r.location, spaceById.get(p.spaceId)!.location);
        assignments.push({ requestId: r.id, offeringId: oid, spaceId: p.spaceId, kind: 'waitlist', score: 0.7, distanceKm: d, waitlistRank: rank, secondBest: null });
      } else {
        unmatched.push({ requestId: r.id, reason: 'No open offering nearby', suggestions: [] });
      }
    }

    const counts = new Map<string, number>();
    for (const r of snapshot.requests) counts.set(`${r.areaId}:${r.categoryId}`, (counts.get(`${r.areaId}:${r.categoryId}`) ?? 0) + 1);
    const insights = [...counts.entries()].map(([key, demand]) => {
      const [areaId = '', categoryId = ''] = key.split(':');
      return { areaId, categoryId, demand, seatsOffered: 0, gap: demand, level: 'Medium' as const };
    });
    const metrics = emptyMetrics();
    metrics.requests = snapshot.requests.length;
    metrics.assigned = assignments.filter((a) => a.kind === 'seat').length;
    metrics.waitlisted = assignments.filter((a) => a.kind === 'waitlist').length;
    metrics.unmatched = unmatched.length;
    metrics.allocations = allocations.length;
    metrics.coverageRate = metrics.requests ? metrics.assigned / metrics.requests : 0;
    return {
      allocations,
      assignments,
      unmatched,
      areaDemand: snapshot.areas.map((a, i) => ({ areaId: a.id, clusterId: i % 2, level: 'Medium', demandIndex: 0.5 })),
      insights,
      cohorts: [],
      metrics,
      baselineMetrics: { ...metrics, coverageRate: metrics.coverageRate * 0.8 },
      k: 2,
      silhouette: 0.5,
    };
  },

  recheckAllocations(snapshot, settings, allocations): RecheckResult[] {
    const spaceById = new Map(snapshot.spaces.map((s) => [s.id, s]));
    const offeringById = new Map(snapshot.offerings.map((o) => [o.id, o]));
    return allocations.map((a) => {
      const space = spaceById.get(a.spaceId);
      const offering = offeringById.get(a.offeringId);
      if (!space || !offering) {
        return { allocationId: a.allocationId, stillFeasible: false, failedConstraint: 'active', reason: 'Space or offering not found', alternatives: [] };
      }
      const failed = staticChecks(space, offering).find((c) => !c.passed);
      const clash = !sessionFits(space, a.session, space.bookings);
      if (!failed && !clash) return { allocationId: a.allocationId, stillFeasible: true, failedConstraint: null, reason: '', alternatives: [] };
      const alternatives = [...snapshot.spaces]
        .filter((s) => s.id !== a.spaceId)
        .sort((x, y) => x.name.localeCompare(y.name))
        .filter((s) => staticChecks(s, offering).every((c) => c.passed) && sessionFits(s, a.session, s.bookings))
        .map((s) => proposal(offering, s, a.session, haversineKm(space.location, s.location), staticChecks(s, offering)))
        .slice(0, settings.alternativesToKeep);
      return {
        allocationId: a.allocationId,
        stillFeasible: false,
        failedConstraint: failed ? failed.constraint : 'time',
        reason: failed ? failed.detail : 'The session clashes with another booking',
        alternatives,
      };
    });
  },

  suggestFor() {
    return [];
  },
};
