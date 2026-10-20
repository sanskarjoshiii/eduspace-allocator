// Transactional publish (PLAN 3.13): writes one run's results in ONE transaction.
// Idempotent by runId: anything an earlier attempt wrote for the run is removed first.

import { Types, type AnyBulkWriteOperation } from 'mongoose';
import { ENROLLMENT_TRANSITIONS, OPEN_REQUEST_STATUSES, canTransition, type EnrollmentStatus, type RequestStatus } from '@/lib/domain';
import { addHours, toHHmm } from '@/lib/utils';
import { formatKm, formatPercent } from '@/lib/format';
import { withTransaction } from '@/lib/db';
import { Allocation, AllocationRun, Area, CourseOffering, DemandInsight, DomainEvent, Enrollment, LearningRequest } from '@/server/models';
import { audit } from '@/server/services/audit';
import type { LearnerAssignment, PipelineResult, ProposedAllocation, TimeWindow } from '@/engine/types';
import { CONFIRMED_STATUSES } from './lifecycle';
import type { SnapshotBundle } from './snapshot';
import type { EnrollmentLean, RunLean } from './types';

type Id = Types.ObjectId;
type EnrollmentBulk = Parameters<typeof Enrollment.bulkWrite>[0];
const oid = (s: string): Id => new Types.ObjectId(s);

export const runRef = (id: Id | string): string => `#${id.toString().slice(-6).toUpperCase()}`;

export interface PublishOutcome {
  newAllocationIds: string[];
  keptAllocationIds: string[];
  supersededAllocationIds: string[];
  /** Requests that became Unmatched in this run (were not Unmatched before). */
  newlyUnmatchedRequestIds: string[];
  /** Enrollments created directly as Offered (seats filled on confirmed classes). */
  offeredEnrollmentIds: string[];
  counts: Record<string, number>;
  decisionSummary: string;
}

export interface PublishOptions {
  now?: Date;
  /** Test hook: runs inside the transaction just before it commits. */
  beforeCommit?: () => Promise<void> | void;
}

const sameSession = (a: { dayOfWeek: number; startTime: string; endTime: string }, b: TimeWindow): boolean =>
  a.dayOfWeek === b.dayOfWeek && a.startTime === toHHmm(b.start) && a.endTime === toHHmm(b.end);

const windowDoc = (w: TimeWindow) => ({ dayOfWeek: w.dayOfWeek, startTime: toHHmm(w.start), endTime: toHHmm(w.end) });

function explainFields(p: ProposedAllocation) {
  return {
    score: p.score,
    distanceKm: p.distanceKm,
    scoreBreakdown: p.breakdown.map((b) => ({ criterion: b.criterion, score: b.score, weight: b.weight, weighted: b.weighted, detail: b.detail })),
    constraints: p.constraints.map((c) => ({ constraint: c.constraint, passed: c.passed, detail: c.detail })),
    rejectedAlternatives: p.rejectedAlternatives
      .filter((r) => Types.ObjectId.isValid(r.spaceId))
      .map((r) => ({
        spaceId: oid(r.spaceId),
        spaceName: r.spaceName,
        session: r.session ? windowDoc(r.session) : null,
        failedConstraint: r.failedConstraint,
        reason: r.reason,
        score: r.score,
        distanceKm: r.distanceKm,
      })),
  };
}

const hist = (status: string, note: string, at: Date) => ({ status, at, by: null, note });

/** Writes a run's results atomically. Throws (and writes nothing) on any failure. */
export async function publishRun(runId: Id, bundle: SnapshotBundle, result: PipelineResult, opts: PublishOptions = {}): Promise<PublishOutcome> {
  const { ctx, appSettings } = bundle;
  const now = opts.now ?? new Date();
  const ref = runRef(runId);

  return withTransaction(async (session) => {
    const so = { session: session ?? undefined };

    // 0. Idempotency: drop anything a previous attempt wrote for this run.
    await Allocation.deleteMany({ runId }, so);
    await Enrollment.deleteMany({ runId }, so);

    // 1. Accept proposals only for re-optimisable offerings, never for a pair the space rejected.
    const proposals = new Map<string, ProposedAllocation>();
    let droppedRejected = 0;
    for (const p of result.allocations) {
      if (!ctx.reoptimisable.has(p.offeringId) || proposals.has(p.offeringId)) continue;
      if (!ctx.spaces.has(p.spaceId)) continue;
      if (ctx.rejectedPairs.has(`${p.offeringId}:${p.spaceId}`)) {
        droppedRejected++;
        continue;
      }
      proposals.set(p.offeringId, p);
    }

    // 2. Supersede or keep current proposals of re-optimised offerings.
    type AllocRef = { id: Id; kind: 'new' | 'kept' | 'fixed'; confirmed: boolean; batchSize: number };
    const allocFor = new Map<string, AllocRef>();
    const kept: string[] = [];
    const superseded: Id[] = [];
    for (const [offeringId, old] of ctx.reoptimisable) {
      const p = proposals.get(offeringId);
      const keep = p ? old.find((a) => a.spaceId.toString() === p.spaceId && sameSession(a.session, p.session)) : undefined;
      for (const a of old) if (a !== keep) superseded.push(a._id);
      if (keep && p) {
        await Allocation.updateOne({ _id: keep._id, status: 'Proposed' }, { $set: explainFields(p) }, so);
        kept.push(keep._id.toString());
        allocFor.set(offeringId, { id: keep._id, kind: 'kept', confirmed: false, batchSize: ctx.offerings.get(offeringId)!.batchSize });
      }
    }
    if (superseded.length > 0) {
      await Allocation.updateMany(
        { _id: { $in: superseded }, status: 'Proposed' },
        { $set: { status: 'Superseded' }, $push: { statusHistory: hist('Superseded', `Replaced by Smart Allocation run ${ref}`, now) } },
        so,
      );
    }

    // 3. Insert new allocations.
    const newDocs = [...proposals.entries()]
      .filter(([offeringId]) => !allocFor.has(offeringId))
      .map(([offeringId, p]) => {
        const offering = ctx.offerings.get(offeringId)!;
        const space = ctx.spaces.get(p.spaceId)!;
        return {
          _id: new Types.ObjectId(),
          runId,
          offeringId: offering._id,
          spaceId: space._id,
          providerUserId: offering.providerUserId,
          spaceOwnerUserId: space.ownerUserId,
          session: windowDoc(p.session),
          strategy: appSettings.strategy,
          status: 'Proposed' as const,
          statusHistory: [hist('Proposed', `Proposed by Smart Allocation run ${ref}`, now)],
          ...explainFields(p),
        };
      });
    if (newDocs.length > 0) await Allocation.insertMany(newDocs, so);
    for (const d of newDocs) {
      allocFor.set(d.offeringId.toString(), { id: d._id, kind: 'new', confirmed: false, batchSize: ctx.offerings.get(d.offeringId.toString())!.batchSize });
    }
    for (const [offeringId, f] of ctx.fixed) {
      allocFor.set(offeringId, {
        id: oid(f.allocationId),
        kind: 'fixed',
        confirmed: CONFIRMED_STATUSES.includes(f.status),
        batchSize: ctx.offerings.get(offeringId)!.batchSize,
      });
    }

    // 4. Enrollments. Places on superseded proposals are cancelled; on a kept proposal
    //    existing enrollments are reused so learners are not re-notified for no change.
    const reoptIds = [...ctx.reoptimisable.keys()].map(oid);
    const existing = await Enrollment.find({ offeringId: { $in: reoptIds }, status: { $in: ['Proposed', 'Waitlisted'] } })
      .session(session ?? null)
      .lean<EnrollmentLean[]>();
    const keptSet = new Set(kept);
    const reusable = new Map<string, EnrollmentLean>();
    const toCancel: EnrollmentLean[] = [];
    for (const e of existing) {
      if (e.allocationId && keptSet.has(e.allocationId.toString())) reusable.set(e.requestId.toString(), e);
      else toCancel.push(e);
    }

    const seats = new Map<string, number>();
    for (const [, f] of ctx.fixed) seats.set(f.allocationId, f.seatsTaken);
    const rankCounter = new Map<string, number>();
    const enrollmentOps: object[] = [];
    const newEnrollments: Record<string, unknown>[] = [];
    const offeredIds: string[] = [];
    const requestOutcome = new Map<string, RequestStatus>();
    const ordered: LearnerAssignment[] = [
      ...result.assignments.filter((a) => a.kind === 'seat'),
      ...result.assignments.filter((a) => a.kind === 'waitlist').sort((a, b) => (a.waitlistRank ?? 0) - (b.waitlistRank ?? 0)),
    ];
    let convertedToWaitlist = 0;
    const learnerOf = new Map(bundle.snapshot.requests.map((r) => [r.id, r.learnerUserId]));
    for (const a of ordered) {
      if (!ctx.requestStatus.has(a.requestId) || requestOutcome.has(a.requestId)) continue;
      const alloc = allocFor.get(a.offeringId);
      const offering = ctx.offerings.get(a.offeringId);
      if (!alloc || !offering) continue; // no allocation for that offering this run: request is re-analysed
      const allocKey = alloc.id.toString();
      let kind = a.kind;
      if (kind === 'seat' && (seats.get(allocKey) ?? 0) >= alloc.batchSize) {
        kind = 'waitlist'; // never exceed the batch size, whatever the engine returned
        convertedToWaitlist++;
      }
      let status: EnrollmentStatus;
      let rank: number | null = null;
      if (kind === 'seat') {
        seats.set(allocKey, (seats.get(allocKey) ?? 0) + 1);
        status = alloc.kind === 'fixed' && alloc.confirmed ? 'Offered' : 'Proposed';
      } else {
        rank = (ctx.maxWaitlistRank.get(allocKey) ?? 0) + (rankCounter.get(allocKey) ?? 0) + 1;
        rankCounter.set(allocKey, (rankCounter.get(allocKey) ?? 0) + 1);
        status = 'Waitlisted';
      }
      const fields = {
        score: a.score,
        distanceKm: a.distanceKm,
        waitlistRank: rank,
        secondBest: a.secondBest && Types.ObjectId.isValid(a.secondBest.offeringId) ? { offeringId: oid(a.secondBest.offeringId), score: a.secondBest.score } : null,
        offerExpiresAt: status === 'Offered' ? addHours(now, appSettings.offerExpiryHours) : null,
      };
      const prev = reusable.get(a.requestId);
      if (prev) {
        reusable.delete(a.requestId);
        if (prev.status === status) {
          enrollmentOps.push({ updateOne: { filter: { _id: prev._id }, update: { $set: fields } } });
        } else if (canTransition(ENROLLMENT_TRANSITIONS, prev.status, status)) {
          enrollmentOps.push({
            updateOne: { filter: { _id: prev._id }, update: { $set: { ...fields, status }, $push: { statusHistory: hist(status, `Run ${ref}`, now) } } },
          });
        }
      } else {
        const id = new Types.ObjectId();
        if (status === 'Offered') offeredIds.push(id.toString());
        newEnrollments.push({
          _id: id,
          requestId: oid(a.requestId),
          learnerUserId: oid(learnerOf.get(a.requestId)!),
          offeringId: offering._id,
          allocationId: alloc.id,
          runId,
          status,
          statusHistory: [hist(status, `Smart Allocation run ${ref}`, now)],
          ...fields,
        });
      }
      requestOutcome.set(a.requestId, kind === 'seat' ? (status === 'Offered' ? 'Offered' : 'Matched') : 'Waitlisted');
    }
    toCancel.push(...reusable.values());
    for (const e of toCancel) {
      enrollmentOps.push({
        updateOne: {
          filter: { _id: e._id, status: e.status },
          update: { $set: { status: 'Cancelled' }, $push: { statusHistory: hist('Cancelled', `Re-optimised by run ${ref}`, now) } },
        },
      });
    }
    if (enrollmentOps.length > 0) await Enrollment.bulkWrite(enrollmentOps as unknown as EnrollmentBulk, so);
    if (newEnrollments.length > 0) await Enrollment.insertMany(newEnrollments, so);

    // 5. Requests.
    const unmatchedById = new Map(result.unmatched.filter((u) => ctx.requestStatus.has(u.requestId)).map((u) => [u.requestId, u]));
    const newlyUnmatched: string[] = [];
    const requestOps: AnyBulkWriteOperation[] = [];
    const placeable = { $in: [...OPEN_REQUEST_STATUSES, 'Waitlisted'] };
    let analysed = 0;
    for (const [requestId, before] of ctx.requestStatus) {
      const outcome = requestOutcome.get(requestId);
      const un = unmatchedById.get(requestId);
      let set: Record<string, unknown>;
      if (outcome) set = { status: outcome, suggestions: [], lastRunId: runId };
      else if (un) {
        if (before !== 'Unmatched') newlyUnmatched.push(requestId);
        set = {
          status: 'Unmatched',
          lastRunId: runId,
          suggestions: un.suggestions
            .filter((s) => Types.ObjectId.isValid(s.categoryId))
            .map((s) => ({
              offeringId: s.offeringId && Types.ObjectId.isValid(s.offeringId) ? oid(s.offeringId) : null,
              categoryId: oid(s.categoryId),
              areaId: s.areaId && Types.ObjectId.isValid(s.areaId) ? oid(s.areaId) : null,
              score: s.score,
              reasons: s.reasons,
            })),
        };
      } else {
        analysed++;
        set = { status: 'Analysed', lastRunId: runId };
      }
      requestOps.push({ updateOne: { filter: { _id: oid(requestId), status: placeable }, update: { $set: set } } });
    }
    if (requestOps.length > 0) await LearningRequest.bulkWrite(requestOps, so);

    // 6. Demand insights and area demand levels.
    if (result.insights.length > 0) {
      await DemandInsight.bulkWrite(
        result.insights
          .filter((i) => Types.ObjectId.isValid(i.areaId) && Types.ObjectId.isValid(i.categoryId))
          .map((i) => ({
            updateOne: {
              filter: { areaId: oid(i.areaId), categoryId: oid(i.categoryId) },
              update: { $set: { runId, level: i.level, demand: i.demand, seatsOffered: i.seatsOffered, gap: i.gap, computedAt: now } },
              upsert: true,
            },
          })),
        so,
      );
    }
    if (result.areaDemand.length > 0) {
      await Area.bulkWrite(
        result.areaDemand
          .filter((a) => Types.ObjectId.isValid(a.areaId))
          .map((a) => ({
            updateOne: { filter: { _id: oid(a.areaId) }, update: { $set: { demandLevel: a.level, clusterId: a.clusterId, demandIndex: a.demandIndex } } },
          })),
        so,
      );
    }

    // 7. Offering statuses.
    const allocatedOfferings = [...proposals.keys()].map(oid);
    if (allocatedOfferings.length > 0) {
      await CourseOffering.updateMany({ _id: { $in: allocatedOfferings }, status: 'Open' }, { $set: { status: 'Allocated' } }, so);
    }
    const lostOfferings = [...ctx.reoptimisable.keys()].filter((id) => !proposals.has(id)).map(oid);
    if (lostOfferings.length > 0) {
      await CourseOffering.updateMany({ _id: { $in: lostOfferings }, status: 'Allocated' }, { $set: { status: 'Open' } }, so);
    }

    // 8. Run record, processed events and the engine decision audit.
    const seated = [...requestOutcome.values()].filter((s) => s === 'Matched' || s === 'Offered').length;
    const waitlisted = [...requestOutcome.values()].filter((s) => s === 'Waitlisted').length;
    const counts: Record<string, number> = {
      requests: ctx.requestStatus.size,
      offerings: ctx.offerings.size,
      spaces: ctx.spaces.size,
      newAllocations: newDocs.length,
      keptAllocations: kept.length,
      supersededAllocations: superseded.length,
      seated,
      waitlisted,
      unmatched: unmatchedById.size,
      analysed,
      offered: offeredIds.length,
      cancelledEnrollments: toCancel.length,
      droppedRejectedPairs: droppedRejected,
      seatsConvertedToWaitlist: convertedToWaitlist,
    };
    const m = result.metrics;
    const b = result.baselineMetrics;
    const decisionSummary =
      `Run ${ref} (${appSettings.strategy}): ${newDocs.length} new and ${kept.length} unchanged proposals, ${superseded.length} superseded; ` +
      `${seated} learners seated, ${waitlisted} waitlisted, ${unmatchedById.size} unmatched across ${ctx.offerings.size} offerings and ${ctx.spaces.size} spaces. ` +
      `Coverage ${formatPercent(m.coverageRate)} against ${formatPercent(b.coverageRate)} for the nearest-space baseline; ` +
      `average distance ${formatKm(m.avgDistanceKm)} against ${formatKm(b.avgDistanceKm)}.` +
      (droppedRejected ? ` ${droppedRejected} proposal(s) skipped because the space had already declined that offering.` : '');

    const run = await AllocationRun.findById(runId).session(session ?? null).lean<RunLean>();
    await AllocationRun.updateOne(
      { _id: runId },
      {
        $set: {
          metrics: result.metrics,
          baselineMetrics: result.baselineMetrics,
          k: result.k,
          silhouette: result.silhouette,
          counts,
          decisionSummary,
          'partitionState.phase': 'notify',
        },
        $addToSet: { 'partitionState.completedPhases': 'publish' },
      },
      so,
    );
    if (run && run.eventIds.length > 0) {
      await DomainEvent.updateMany({ _id: { $in: run.eventIds }, processedAt: null }, { $set: { processedAt: now, runId } }, so);
    }
    await audit({
      actor: null,
      action: 'engine',
      entity: 'AllocationRun',
      entityId: runId,
      ownerUserId: null,
      diff: { counts, decisionSummary, metrics: result.metrics, superseded: superseded.map(String) },
      session,
    });

    if (opts.beforeCommit) await opts.beforeCommit();

    return {
      newAllocationIds: newDocs.map((d) => d._id.toString()),
      keptAllocationIds: kept,
      supersededAllocationIds: superseded.map(String),
      newlyUnmatchedRequestIds: newlyUnmatched,
      offeredEnrollmentIds: offeredIds,
      counts,
      decisionSummary,
    };
  });
}

