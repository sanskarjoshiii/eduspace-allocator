// Reallocation (PLAN 7.2, README 7.3 and 13.9): re-check booked allocations after a
// facility change, mark only the failing ones Needs reallocation, propose the engine's
// best alternative, and move a class only after the space and the provider confirm.

import { Types } from 'mongoose';
import {
  ALLOCATION_TRANSITIONS,
  BOOKING_ALLOCATION_STATUSES,
  canTransition,
  type AllocationStatus,
} from '@/lib/domain';
import { formatDate, formatKm, formatWindow } from '@/lib/format';
import { toHHmm } from '@/lib/utils';
import { logger } from '@/lib/logger';
import type { SessionUser } from '@/server/auth/session';
import { conflict, notFound } from '@/server/http';
import { Allocation, CourseOffering, Enrollment, Schedule, Space } from '@/server/models';
import { audit } from '@/server/services/audit';
import { emitEvent } from '@/server/services/events';
import { getEngine } from '@/server/services/engine-client';
import { adminIds } from '@/server/notifications/notify';
import type { ProposedAllocation, RecheckResult, TimeWindow } from '@/engine/types';
import { applyApprovalMode } from '@/server/worker/approval';
import { baseVars, learnersOn, loadAllocationContext } from '@/server/worker/context';
import {
  ACTIVE_ENROLLMENT_STATUSES,
  forceAllocationStatus,
  istToday,
  safeNotify,
  setAllocationStatus,
  setRequestStatus,
} from '@/server/worker/lifecycle';
import { buildSnapshotWithContext, toTimeWindow } from '@/server/worker/snapshot';
import type { AllocationLean, EnrollmentLean, SpaceLean, WindowDoc } from '@/server/worker/types';
import { cancelEnrollmentsOfAllocation } from './enrollments';
import { generateSchedules, retireFutureSessions } from './scheduling';

type Id = Types.ObjectId;
const windowDoc = (w: TimeWindow): WindowDoc => ({ dayOfWeek: w.dayOfWeek, startTime: toHHmm(w.start), endTime: toHHmm(w.end) });

/** Statuses re-checked after a facility issue. ApprovedBySpace is booked but not yet confirmed. */
const RECHECKED: AllocationStatus[] = ['ApprovedBySpace', 'ConfirmedByProvider', 'Scheduled', 'Active'];

export interface RecheckTarget {
  alloc: AllocationLean;
  /** Check this space / session instead of the current one (override move). */
  spaceId?: string;
  session?: WindowDoc;
}

/** Re-checks allocations against the current data with the engine (their own bookings excluded). */
export async function recheck(targets: RecheckTarget[]): Promise<RecheckResult[]> {
  if (targets.length === 0) return [];
  const spaceIds = [...new Set(targets.flatMap((t) => [t.alloc.spaceId.toString(), ...(t.spaceId ? [t.spaceId] : [])]))];
  const spaces = await Space.find({ _id: { $in: spaceIds } }).select('location').lean<SpaceLean[]>();
  const bundle = await buildSnapshotWithContext({
    trigger: 'reallocation',
    includeSpaceIds: spaceIds,
    includeOfferingIds: targets.map((t) => t.alloc.offeringId.toString()),
    excludeBookingAllocationIds: targets.map((t) => t.alloc._id.toString()),
    extraCentres: spaces.map((s) => ({ lng: s.location.coordinates[0] ?? 0, lat: s.location.coordinates[1] ?? 0 })),
  });
  return getEngine().recheckAllocations(
    bundle.snapshot,
    bundle.settings,
    targets.map((t) => ({
      allocationId: t.alloc._id.toString(),
      offeringId: t.alloc.offeringId.toString(),
      spaceId: t.spaceId ?? t.alloc.spaceId.toString(),
      session: toTimeWindow(t.session ?? t.alloc.session),
    })),
  );
}

/** Creates the replacement proposal for an allocation that no longer fits. */
async function createReplacement(old: AllocationLean, alt: ProposedAllocation, actor: SessionUser | null): Promise<AllocationLean | null> {
  const space = await Space.findById(alt.spaceId).lean<SpaceLean>();
  if (!space) return null;
  const doc = await Allocation.create({
    runId: null,
    offeringId: old.offeringId,
    spaceId: space._id,
    providerUserId: old.providerUserId,
    spaceOwnerUserId: space.ownerUserId,
    session: windowDoc(alt.session),
    score: alt.score,
    distanceKm: alt.distanceKm,
    scoreBreakdown: alt.breakdown,
    constraints: alt.constraints,
    rejectedAlternatives: alt.rejectedAlternatives
      .filter((r) => Types.ObjectId.isValid(r.spaceId))
      .map((r) => ({ ...r, spaceId: new Types.ObjectId(r.spaceId), session: r.session ? windowDoc(r.session) : null })),
    strategy: old.strategy,
    status: 'Proposed',
    statusHistory: [{ status: 'Proposed', at: new Date(), by: null, note: 'Reallocation proposal after a facility issue' }],
    replacesAllocationId: old._id,
  });
  await audit({ actor, action: 'engine', entity: 'Allocation', entityId: doc._id, ownerUserId: old.providerUserId, diff: { replaces: old._id.toString(), spaceId: alt.spaceId, score: alt.score } });
  return doc.toObject() as unknown as AllocationLean;
}

export interface FacilityChangeResult {
  affectedAllocationIds: Id[];
  replacementIds: Id[];
}

/**
 * After a facility issue on `spaceId`: re-check the booked allocations there. Unaffected
 * allocations are untouched. Failing confirmed / scheduled / active ones become Needs
 * reallocation with a replacement proposal; failing approved-but-unconfirmed ones are
 * cancelled and go back to the engine (nothing was promised to learners yet).
 */
export async function handleFacilityChange(
  spaceId: Id,
  issue: { quantity: number; facilityName: string },
  actor: SessionUser | null,
): Promise<FacilityChangeResult> {
  const booked = await Allocation.find({ spaceId, status: { $in: RECHECKED } }).lean<AllocationLean[]>();
  const results = await recheck(booked.map((alloc) => ({ alloc })));
  const byId = new Map(booked.map((a) => [a._id.toString(), a]));
  const affected: Id[] = [];
  const replacements: Id[] = [];
  const admins = await adminIds();

  for (const r of results.filter((x) => !x.stillFeasible)) {
    const alloc = byId.get(r.allocationId);
    if (!alloc) continue;
    const c = await loadAllocationContext(alloc);
    const note = `Facility issue: ${issue.quantity} ${issue.facilityName} down. ${r.reason}`.trim();
    if (alloc.status === 'ApprovedBySpace') {
      await setAllocationStatus(alloc._id, 'Cancelled', { actor, note });
      const { requestIds } = await cancelEnrollmentsOfAllocation(alloc._id, actor, note);
      await setRequestStatus(requestIds, 'Analysed', { actor, note });
      await reopenOfferingIfIdle(alloc.offeringId);
      await emitEvent('offering.saved', alloc.offeringId, { reason: 'facilityIssue', allocationId: alloc._id.toString() });
      affected.push(alloc._id);
      continue;
    }
    await setAllocationStatus(alloc._id, 'NeedsReallocation', { actor, note });
    affected.push(alloc._id);
    const learners = await learnersOn(alloc._id, ['Accepted']);
    await safeNotify({
      type: 'facility.issueReported',
      userIds: [alloc.providerUserId, ...learners],
      vars: { ...baseVars(c), quantity: issue.quantity, facilityName: issue.facilityName },
      related: { type: 'Allocation', id: alloc._id },
      href: `/allocations/${alloc._id.toString()}`,
    });

    const alt = r.alternatives.find((a) => !(a.spaceId === alloc.spaceId.toString() && formatWindow(windowDoc(a.session)) === c.session));
    if (!alt) {
      logger.warn('reallocation.no_alternative', { allocationId: alloc._id.toString() });
      continue;
    }
    const replacement = await createReplacement(alloc, alt, actor);
    if (!replacement) continue;
    replacements.push(replacement._id);
    const newSpace = await Space.findById(replacement.spaceId).select('name').lean();
    const vars = {
      courseTitle: c.offering.title,
      newSpaceName: newSpace?.name ?? '',
      oldSpaceName: c.space.name,
      distance: formatKm(alt.distanceKm),
      session: formatWindow(replacement.session),
    };
    const everyLearner = await learnersOn(alloc._id, ['Accepted', 'Offered']);
    await safeNotify({
      type: 'reallocation.proposed',
      userIds: [alloc.providerUserId, replacement.spaceOwnerUserId, ...everyLearner, ...admins],
      vars,
      related: { type: 'Allocation', id: replacement._id },
      href: `/allocations/${replacement._id.toString()}`,
    });
    await applyApprovalMode([replacement._id], null);
  }
  return { affectedAllocationIds: affected, replacementIds: replacements };
}

/** Sets an offering back to Open when none of its allocations is live any more. */
export async function reopenOfferingIfIdle(offeringId: Id): Promise<void> {
  const live = await Allocation.countDocuments({
    offeringId,
    status: { $in: ['Proposed', 'ApprovedBySpace', 'ConfirmedByProvider', 'Scheduled', 'Active', 'NeedsReallocation'] },
  });
  if (live === 0) await CourseOffering.updateOne({ _id: offeringId, status: 'Allocated' }, { $set: { status: 'Open' } });
}

/** The status an allocation had before it became Needs reallocation. */
export function previousStatus(alloc: AllocationLean): AllocationStatus {
  const hist = alloc.statusHistory ?? [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const s = hist[i]!.status as AllocationStatus;
    if (s !== 'NeedsReallocation') return s;
  }
  return 'ConfirmedByProvider';
}

/**
 * Returns an allocation from Needs reallocation to the status it had before.
 * Documented exception: NeedsReallocation → ConfirmedByProvider is not in
 * ALLOCATION_TRANSITIONS, but restoring a confirmed class that was never scheduled
 * needs it, so that one restore is written directly (and audited).
 */
async function restore(alloc: AllocationLean, actor: SessionUser | null, note: string): Promise<AllocationStatus> {
  const prev = previousStatus(alloc);
  if (canTransition(ALLOCATION_TRANSITIONS, 'NeedsReallocation', prev)) await setAllocationStatus(alloc._id, prev, { actor, note });
  else await forceAllocationStatus(alloc, prev, { actor, note: `${note} (restored)` });
  return prev;
}

/** Withdraws replacement proposals that have not been confirmed. */
async function withdrawReplacements(oldId: Id, actor: SessionUser | null, note: string, exceptId?: Id): Promise<number> {
  const pending = await Allocation.find({ replacesAllocationId: oldId, status: { $in: ['Proposed', 'ApprovedBySpace'] }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean<AllocationLean[]>();
  for (const p of pending) await setAllocationStatus(p._id, p.status === 'Proposed' ? 'Superseded' : 'Cancelled', { actor, note });
  return pending.length;
}

/** After a facility issue is resolved: allocations that fit again return to their previous status. */
export async function restoreAfterResolve(allocationIds: Id[], actor: SessionUser | null): Promise<{ restored: string[] }> {
  const allocs = await Allocation.find({ _id: { $in: allocationIds }, status: 'NeedsReallocation' }).lean<AllocationLean[]>();
  const results = await recheck(allocs.map((alloc) => ({ alloc })));
  const restored: string[] = [];
  for (const r of results.filter((x) => x.stillFeasible)) {
    const alloc = allocs.find((a) => a._id.toString() === r.allocationId);
    if (!alloc) continue;
    await restore(alloc, actor, 'Facility issue resolved; the class stays here');
    await withdrawReplacements(alloc._id, actor, 'Facility issue resolved; the original space fits again');
    restored.push(alloc._id.toString());
    const c = await loadAllocationContext(alloc);
    const learners = await learnersOn(alloc._id, ['Accepted', 'Offered']);
    await safeNotify({
      type: 'schedule.changed',
      userIds: [alloc.providerUserId, alloc.spaceOwnerUserId, ...learners],
      vars: { ...baseVars(c), change: `The facility issue at ${c.space.name} is resolved, so the class stays there (${c.session}).` },
      related: { type: 'Allocation', id: alloc._id },
      href: `/allocations/${alloc._id.toString()}`,
    });
  }
  return { restored };
}

/**
 * Completes a confirmed reallocation: the old allocation is cancelled, its learners move
 * to the replacement with their status (Accepted stays Accepted, Offered keeps its expiry),
 * and the old allocation's future sessions are marked Moved. Returns how many sessions
 * remain, so the new schedule covers only those.
 */
export async function completeReallocationMove(replacement: AllocationLean, actor: SessionUser | null): Promise<{ remainingSessions: number | undefined }> {
  if (!replacement.replacesAllocationId) return { remainingSessions: undefined };
  const old = await Allocation.findById(replacement.replacesAllocationId).lean<AllocationLean>();
  if (!old) throw notFound('Original allocation');
  const [oldCtx, newCtx] = await Promise.all([loadAllocationContext(old), loadAllocationContext(replacement)]);
  const note = `Moved to ${newCtx.space.name}, ${newCtx.session}`;

  if (old.status === 'NeedsReallocation') await setAllocationStatus(old._id, 'Cancelled', { actor, note });
  const moving = await Enrollment.find({ allocationId: old._id, status: { $in: ACTIVE_ENROLLMENT_STATUSES } }).lean<EnrollmentLean[]>();
  if (moving.length > 0) {
    await Enrollment.bulkWrite(
      moving.map((e) => ({
        updateOne: {
          filter: { _id: e._id },
          update: {
            $set: { allocationId: replacement._id },
            $push: { statusHistory: { status: e.status, at: new Date(), by: actor ? new Types.ObjectId(actor.id) : null, note } },
          },
        },
      })) as unknown as Parameters<typeof Enrollment.bulkWrite>[0],
    );
  }
  const retired = await retireFutureSessions(old._id, 'Moved', note);
  await withdrawReplacements(old._id, actor, 'Another replacement was confirmed', replacement._id);
  await audit({ actor, action: 'update', entity: 'Allocation', entityId: replacement._id, ownerUserId: replacement.providerUserId, diff: { movedFrom: old._id.toString(), enrollments: moving.length, sessionsMoved: retired } });

  const learners = moving.filter((e) => e.status === 'Accepted' || e.status === 'Offered').map((e) => e.learnerUserId);
  const change = `The class moves from ${oldCtx.space.name} to ${newCtx.space.name}, ${newCtx.session}.`;
  await safeNotify({
    type: 'schedule.changed',
    userIds: [...learners, replacement.providerUserId, old.spaceOwnerUserId, replacement.spaceOwnerUserId],
    vars: { ...baseVars(newCtx), change },
    related: { type: 'Allocation', id: replacement._id },
    href: `/allocations/${replacement._id.toString()}`,
  });
  return { remainingSessions: retired > 0 ? retired : undefined };
}

/**
 * Administrator move (override): re-checks the target with the engine and refuses
 * clashes; on success the allocation, its future sessions and everyone involved follow.
 */
export async function moveAllocation(
  alloc: AllocationLean,
  actor: SessionUser,
  target: { spaceId?: string; session?: WindowDoc },
  note: string,
): Promise<void> {
  if (!['Proposed', 'ApprovedBySpace', 'ConfirmedByProvider', 'Scheduled', 'Active', 'NeedsReallocation'].includes(alloc.status)) {
    throw conflict('Only a live allocation can be moved.');
  }
  const spaceId = target.spaceId ?? alloc.spaceId.toString();
  const session = target.session ?? alloc.session;
  const space = await Space.findById(spaceId).lean<SpaceLean>();
  if (!space) throw notFound('Space');

  const clash = await Allocation.findOne({
    _id: { $ne: alloc._id },
    spaceId: space._id,
    status: { $in: BOOKING_ALLOCATION_STATUSES },
    'session.dayOfWeek': session.dayOfWeek,
    'session.startTime': { $lt: session.endTime },
    'session.endTime': { $gt: session.startTime },
  }).lean<AllocationLean>();
  if (clash) throw conflict(`That time clashes with another booking at ${space.name} (${formatWindow(clash.session)}).`, { failedConstraint: 'time' });
  const [result] = await recheck([{ alloc, spaceId, session }]);
  if (!result || !result.stillFeasible) {
    throw conflict(`The move does not fit: ${result?.reason || 'a hard constraint fails'}.`, { failedConstraint: result?.failedConstraint ?? null });
  }

  const oldCtx = await loadAllocationContext(alloc);
  const label = `${space.name}, ${formatWindow(session)}`;
  await Allocation.updateOne(
    { _id: alloc._id },
    {
      $set: { spaceId: space._id, spaceOwnerUserId: space.ownerUserId, session, overrideNote: note },
      $push: { statusHistory: { status: alloc.status, at: new Date(), by: new Types.ObjectId(actor.id), note: `Moved by an administrator to ${label}: ${note}` } },
    },
  );
  await audit({
    actor,
    action: 'override',
    entity: 'Allocation',
    entityId: alloc._id,
    ownerUserId: alloc.providerUserId,
    diff: { action: 'move', note, from: { spaceId: alloc.spaceId.toString(), session: alloc.session }, to: { spaceId, session } },
  });
  const moved = await Allocation.findById(alloc._id).lean<AllocationLean>();
  if (!moved) return;
  const retired = await retireFutureSessions(alloc._id, 'Moved', `Moved to ${label}`);
  let firstDate: Date | null = null;
  if (retired > 0) firstDate = (await generateSchedules(moved, { count: retired })).firstDate;
  if (moved.status === 'NeedsReallocation') {
    await restore(moved, actor, `Moved by an administrator to ${label}`);
    await withdrawReplacements(moved._id, actor, 'An administrator moved the original allocation');
  }
  const learners = await learnersOn(alloc._id, ['Accepted', 'Offered']);
  const newCtx = await loadAllocationContext(alloc._id);
  await safeNotify({
    type: 'schedule.changed',
    userIds: [...learners, alloc.providerUserId, alloc.spaceOwnerUserId, space.ownerUserId],
    vars: {
      ...baseVars(newCtx),
      change: `The class moves from ${oldCtx.space.name}, ${oldCtx.session} to ${label}${firstDate ? ` from ${formatDate(firstDate)}` : ''}.`,
    },
    related: { type: 'Allocation', id: alloc._id },
    href: `/allocations/${alloc._id.toString()}`,
  });
}

/** Future sessions still planned for an allocation (used by DTOs and tests). */
export async function futureSessionCount(allocationId: Id): Promise<number> {
  return Schedule.countDocuments({ allocationId, status: 'Planned', date: { $gte: istToday() } });
}
