// Enrollments and offers (PLAN 4.1, 4.4, 4.5): offers with expiry, accept / decline,
// waitlist promotion that never exceeds the batch size, expiry and reminder jobs, rosters.

import { Types } from 'mongoose';
import { SEAT_HOLDING_ENROLLMENT_STATUSES, type AllocationStatus } from '@/lib/domain';
import { formatDateTime, formatKm } from '@/lib/format';
import { addHours } from '@/lib/utils';
import { logger } from '@/lib/logger';
import type { SessionUser } from '@/server/auth/session';
import { HttpError, conflict, forbidden, isAdmin, notFound } from '@/server/http';
import {
  Allocation,
  Area,
  CourseCategory,
  CourseOffering,
  Enrollment,
  LearnerProfile,
  LearningRequest,
  Partner,
  Space,
  User,
} from '@/server/models';
import { getSettings } from '@/server/services/settings';
import { learnerViewFor, stageFromEnrollment, type LearnerSource } from '@/server/dto/privacy';
import {
  toMyEnrollmentDto,
  type EnrollmentActionDto,
  type MyEnrollmentDto,
  type RosterDto,
  type RosterEntryDto,
} from '@/server/dto/enrollment';
import { baseVars, loadAllocationContext } from '@/server/worker/context';
import { ACTIVE_ENROLLMENT_STATUSES, CONFIRMED_STATUSES, safeNotify, setEnrollmentStatus, setRequestStatus } from '@/server/worker/lifecycle';
import type { AllocationLean, EnrollmentLean, OfferingLean, RequestLean, SpaceLean } from '@/server/worker/types';
import { ensureScheduled } from './scheduling';

type Id = Types.ObjectId;

const offerVars = async (alloc: AllocationLean, e: EnrollmentLean) => {
  const c = await loadAllocationContext(alloc);
  return {
    ...baseVars(c),
    distance: e.distanceKm !== null && e.distanceKm !== undefined ? formatKm(e.distanceKm) : 'a short distance',
    expiresAt: formatDateTime(e.offerExpiresAt),
  };
};

/**
 * Proposed enrollments on a confirmed allocation become Offered with an expiry; their
 * requests become Offered and each learner gets 'offer.sent'.
 */
export async function offerProposedEnrollments(allocationId: Id, actor: SessionUser | null, now: Date = new Date()): Promise<number> {
  const alloc = await Allocation.findById(allocationId).lean<AllocationLean>();
  if (!alloc) return 0;
  const settings = await getSettings();
  const proposed = await Enrollment.find({ allocationId, status: 'Proposed' }).lean<EnrollmentLean[]>();
  let offered = 0;
  for (const e of proposed) {
    const updated = await setEnrollmentStatus(e, 'Offered', {
      actor,
      note: 'Provider confirmed the class',
      set: { offerExpiresAt: addHours(now, settings.offerExpiryHours), expiringNotifiedAt: null },
    });
    await setRequestStatus([e.requestId], 'Offered', { actor, skipAudit: true });
    await safeNotify({
      type: 'offer.sent',
      userIds: [e.learnerUserId],
      vars: await offerVars(alloc, updated),
      related: { type: 'Enrollment', id: e._id },
      href: '/offers',
    });
    offered++;
  }
  return offered;
}

/**
 * Fills free seats on an allocation from its waitlist, best rank first. A promoted learner
 * is Offered (with expiry) when the class is confirmed, otherwise Proposed. The seat count
 * is re-read before every promotion, so promotion never exceeds the batch size.
 */
export async function promoteWaitlist(allocationId: Id | null, actor: SessionUser | null, now: Date = new Date()): Promise<string[]> {
  if (!allocationId) return [];
  const alloc = await Allocation.findById(allocationId).lean<AllocationLean>();
  if (!alloc || !['Proposed', 'ApprovedBySpace', 'ConfirmedByProvider', 'Scheduled', 'Active'].includes(alloc.status)) return [];
  const offering = await CourseOffering.findById(alloc.offeringId).select('batchSize').lean<OfferingLean>();
  if (!offering) return [];
  const settings = await getSettings();
  const confirmed = CONFIRMED_STATUSES.includes(alloc.status);
  const promoted: string[] = [];
  for (;;) {
    const taken = await Enrollment.countDocuments({ allocationId, status: { $in: SEAT_HOLDING_ENROLLMENT_STATUSES } });
    if (taken >= offering.batchSize) break;
    const next = await Enrollment.findOne({ allocationId, status: 'Waitlisted' }).sort({ waitlistRank: 1, createdAt: 1 }).lean<EnrollmentLean>();
    if (!next) break;
    const to = confirmed ? 'Offered' : 'Proposed';
    let updated: EnrollmentLean;
    try {
      updated = await setEnrollmentStatus(next, to, {
        actor,
        note: 'A seat opened up',
        set: { waitlistRank: null, offerExpiresAt: confirmed ? addHours(now, settings.offerExpiryHours) : null, expiringNotifiedAt: null },
      });
    } catch {
      continue; // promoted concurrently; re-read and try the next one
    }
    await setRequestStatus([next.requestId], confirmed ? 'Offered' : 'Matched', { actor, skipAudit: true });
    promoted.push(next._id.toString());
    if (confirmed) {
      await safeNotify({
        type: 'waitlist.promoted',
        userIds: [next.learnerUserId],
        vars: await offerVars(alloc, updated),
        related: { type: 'Enrollment', id: next._id },
        href: '/offers',
      });
    }
  }
  if (promoted.length > 0) {
    // Close the gaps in the remaining waitlist ranks.
    const rest = await Enrollment.find({ allocationId, status: 'Waitlisted' }).sort({ waitlistRank: 1, createdAt: 1 }).select('_id').lean();
    await Enrollment.bulkWrite(rest.map((r, i) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { waitlistRank: i + 1 } } } })));
  }
  return promoted;
}

async function requestStatusOf(requestId: Id): Promise<string | null> {
  const r = await LearningRequest.findById(requestId).select('status').lean();
  return r?.status ?? null;
}

async function allocationStatusOf(allocationId: Id | null): Promise<AllocationStatus | null> {
  if (!allocationId) return null;
  const a = await Allocation.findById(allocationId).select('status').lean<AllocationLean>();
  return a?.status ?? null;
}

async function loadOwnEnrollment(user: SessionUser, id: Id): Promise<EnrollmentLean> {
  const e = await Enrollment.findById(id).lean<EnrollmentLean>();
  if (!e) throw notFound('Enrollment');
  if (e.learnerUserId.toString() !== user.id && !isAdmin(user)) throw forbidden('This offer belongs to another learner.');
  return e;
}

/** Expires one offer: Expired, request Expired, learner told, seat goes to the waitlist. */
async function expireOne(e: EnrollmentLean, actor: SessionUser | null, now: Date): Promise<void> {
  await setEnrollmentStatus(e, 'Expired', { actor, note: 'Offer expired' });
  await setRequestStatus([e.requestId], 'Expired', { actor, skipAudit: true, onlyFrom: ['Offered'] });
  const offering = await CourseOffering.findById(e.offeringId).select('title').lean();
  await safeNotify({ type: 'offer.expired', userIds: [e.learnerUserId], vars: { courseTitle: offering?.title ?? '' }, related: { type: 'Enrollment', id: e._id } });
  await promoteWaitlist(e.allocationId, actor, now);
}

export async function acceptEnrollment(user: SessionUser, id: Id, now: Date = new Date()): Promise<EnrollmentActionDto> {
  const e = await loadOwnEnrollment(user, id);
  if (e.status !== 'Offered') throw conflict(`This offer cannot be accepted because it is ${e.status}.`, { status: e.status });
  if (e.offerExpiresAt && new Date(e.offerExpiresAt) < now) {
    await expireOne(e, null, now);
    throw new HttpError(410, 'expired', 'This offer expired.');
  }
  const updated = await setEnrollmentStatus(e, 'Accepted', { actor: user, action: 'accept', note: 'Learner accepted the offer' });
  await setRequestStatus([e.requestId], 'Accepted', { actor: user, skipAudit: true });

  if (e.allocationId) {
    const alloc = await Allocation.findById(e.allocationId).lean<AllocationLean>();
    if (alloc) {
      const c = await loadAllocationContext(alloc);
      const [profile, accepted] = await Promise.all([
        LearnerProfile.findOne({ userId: e.learnerUserId }).select('name').lean(),
        Enrollment.countDocuments({ allocationId: alloc._id, status: 'Accepted' }),
      ]);
      await safeNotify({
        type: 'offer.accepted',
        userIds: [alloc.providerUserId],
        vars: { ...baseVars(c), learnerName: profile?.name ?? 'A learner', seatsTaken: accepted, batchSize: c.offering.batchSize },
        related: { type: 'Allocation', id: alloc._id },
        href: `/allocations/${alloc._id.toString()}`,
      });
      await ensureScheduled(alloc._id, user, { newlyAcceptedLearnerId: e.learnerUserId, now });
    }
  }
  return { id: updated._id.toString(), status: updated.status, requestStatus: await requestStatusOf(e.requestId), allocationStatus: await allocationStatusOf(e.allocationId) };
}

export async function declineEnrollment(user: SessionUser, id: Id, now: Date = new Date()): Promise<EnrollmentActionDto> {
  const e = await loadOwnEnrollment(user, id);
  if (e.status !== 'Offered') throw conflict(`This offer cannot be declined because it is ${e.status}.`, { status: e.status });
  const updated = await setEnrollmentStatus(e, 'Declined', { actor: user, action: 'decline', note: 'Learner declined the offer' });
  await setRequestStatus([e.requestId], 'Declined', { actor: user, skipAudit: true });
  if (e.allocationId) {
    const alloc = await Allocation.findById(e.allocationId).lean<AllocationLean>();
    if (alloc) {
      const c = await loadAllocationContext(alloc);
      await safeNotify({
        type: 'offer.declined',
        userIds: [alloc.providerUserId],
        vars: baseVars(c),
        related: { type: 'Allocation', id: alloc._id },
        href: `/allocations/${alloc._id.toString()}`,
      });
    }
  }
  await promoteWaitlist(e.allocationId, null, now);
  return { id: updated._id.toString(), status: updated.status, requestStatus: await requestStatusOf(e.requestId), allocationStatus: await allocationStatusOf(e.allocationId) };
}

export interface OfferJobResult {
  expired: number;
  reminded: number;
}

/** Hourly job: expire overdue offers (promoting the waitlist) and send "expiring soon" reminders. */
export async function runOfferJobs(now: Date = new Date()): Promise<OfferJobResult> {
  const settings = await getSettings();
  const overdue = await Enrollment.find({ status: 'Offered', offerExpiresAt: { $lt: now } }).lean<EnrollmentLean[]>();
  let expired = 0;
  for (const e of overdue) {
    try {
      await expireOne(e, null, now);
      expired++;
    } catch (err) {
      logger.warn('offers.expire_failed', { enrollmentId: e._id.toString(), message: (err as Error).message });
    }
  }
  const soon = await Enrollment.find({
    status: 'Offered',
    expiringNotifiedAt: null,
    offerExpiresAt: { $gte: now, $lte: addHours(now, settings.offerExpiringNoticeHours) },
  }).lean<EnrollmentLean[]>();
  let reminded = 0;
  for (const e of soon) {
    const res = await Enrollment.updateOne({ _id: e._id, expiringNotifiedAt: null }, { $set: { expiringNotifiedAt: now } });
    if (res.modifiedCount === 0) continue;
    const offering = await CourseOffering.findById(e.offeringId).select('title').lean();
    await safeNotify({
      type: 'offer.expiring',
      userIds: [e.learnerUserId],
      vars: { courseTitle: offering?.title ?? '', expiresAt: formatDateTime(e.offerExpiresAt) },
      related: { type: 'Enrollment', id: e._id },
      href: '/offers',
    });
    reminded++;
  }
  return { expired, reminded };
}

/**
 * Cancels every live enrollment of a request (Proposed, Offered, Waitlisted, Accepted),
 * frees the seats and promotes the waitlist where a seat freed. Used when a learner
 * cancels their request.
 */
export async function releaseEnrollmentsForRequest(requestId: string, actor: SessionUser | null): Promise<void> {
  const live = await Enrollment.find({ requestId: new Types.ObjectId(requestId), status: { $in: ACTIVE_ENROLLMENT_STATUSES } }).lean<EnrollmentLean[]>();
  const freed = new Set<string>();
  for (const e of live) {
    try {
      await setEnrollmentStatus(e, 'Cancelled', { actor, note: 'The learner cancelled the request' });
    } catch (err) {
      logger.warn('enrollments.release_failed', { enrollmentId: e._id.toString(), message: (err as Error).message });
      continue;
    }
    if (e.allocationId && SEAT_HOLDING_ENROLLMENT_STATUSES.includes(e.status)) freed.add(e.allocationId.toString());
  }
  for (const allocationId of freed) await promoteWaitlist(new Types.ObjectId(allocationId), actor);
}

/**
 * Cancels the live enrollments on an allocation (reject or cancel). Returns the request ids
 * so the caller can send them back to the engine.
 */
export async function cancelEnrollmentsOfAllocation(allocationId: Id, actor: SessionUser | null, note: string): Promise<{ requestIds: Id[]; learnerIds: Id[] }> {
  const live = await Enrollment.find({ allocationId, status: { $in: ACTIVE_ENROLLMENT_STATUSES } }).lean<EnrollmentLean[]>();
  const requestIds: Id[] = [];
  const learnerIds: Id[] = [];
  for (const e of live) {
    try {
      await setEnrollmentStatus(e, 'Cancelled', { actor, note });
      requestIds.push(e.requestId);
      learnerIds.push(e.learnerUserId);
    } catch (err) {
      logger.warn('enrollments.cancel_failed', { enrollmentId: e._id.toString(), message: (err as Error).message });
    }
  }
  return { requestIds, learnerIds };
}

/** The learner's own enrollments, newest first. */
export async function listMyEnrollments(user: SessionUser): Promise<MyEnrollmentDto[]> {
  const rows = await Enrollment.find({ learnerUserId: new Types.ObjectId(user.id) }).sort({ createdAt: -1 }).limit(200).lean<EnrollmentLean[]>();
  if (rows.length === 0) return [];
  const allocIds = rows.map((r) => r.allocationId).filter((v): v is Id => Boolean(v));
  const allocs = await Allocation.find({ _id: { $in: allocIds } }).lean<AllocationLean[]>();
  const offerings = await CourseOffering.find({ _id: { $in: rows.map((r) => r.offeringId) } }).lean<OfferingLean[]>();
  const spaces = await Space.find({ _id: { $in: allocs.map((a) => a.spaceId) } }).lean<SpaceLean[]>();
  const [areas, categories, partners, users] = await Promise.all([
    Area.find({ _id: { $in: spaces.map((s) => s.areaId) } }).select('name').lean(),
    CourseCategory.find({ _id: { $in: offerings.map((o) => o.categoryId) } }).select('name').lean(),
    Partner.find({ userId: { $in: offerings.map((o) => o.providerUserId) } }).select('userId name').lean(),
    User.find({ _id: { $in: offerings.map((o) => o.providerUserId) } }).select('name').lean(),
  ]);
  const allocById = new Map(allocs.map((a) => [a._id.toString(), a]));
  const offById = new Map(offerings.map((o) => [o._id.toString(), o]));
  const spaceById = new Map(spaces.map((s) => [s._id.toString(), s]));
  const areaName = new Map(areas.map((a) => [a._id.toString(), a.name]));
  const catName = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const providerName = new Map(users.map((u) => [u._id.toString(), u.name]));
  for (const p of partners) providerName.set(p.userId.toString(), p.name);

  return rows.map((e) => {
    const a = e.allocationId ? allocById.get(e.allocationId.toString()) : undefined;
    const o = offById.get(e.offeringId.toString());
    const s = a ? spaceById.get(a.spaceId.toString()) : undefined;
    return toMyEnrollmentDto(e, {
      allocationStatus: a?.status ?? null,
      courseTitle: o?.title ?? '',
      categoryName: o ? (catName.get(o.categoryId.toString()) ?? '') : '',
      providerName: o ? (providerName.get(o.providerUserId.toString()) ?? '') : '',
      spaceId: s ? s._id.toString() : null,
      spaceName: s?.name ?? '',
      spaceAddress: s?.address ?? '',
      areaName: s ? (areaName.get(s.areaId.toString()) ?? '') : '',
      spaceLocation: s ? [s.location.coordinates[0] ?? 0, s.location.coordinates[1] ?? 0] : null,
      session: a ? a.session : null,
      startDate: o?.startDate ?? null,
      durationWeeks: o?.durationWeeks ?? null,
      feePerMonth: o?.feePerMonth ?? null,
    });
  });
}

/** Learner sources for a set of enrollments (the privacy mapper decides what is shown). */
export async function learnerSources(enrollments: EnrollmentLean[]): Promise<Map<string, LearnerSource>> {
  const requests = await LearningRequest.find({ _id: { $in: enrollments.map((e) => e.requestId) } }).lean<RequestLean[]>();
  const [profiles, areas, categories] = await Promise.all([
    LearnerProfile.find({ _id: { $in: requests.map((r) => r.learnerProfileId) } }).lean(),
    Area.find({ _id: { $in: requests.map((r) => r.areaId) } }).select('name center').lean(),
    CourseCategory.find({ _id: { $in: requests.map((r) => r.categoryId) } }).select('name').lean(),
  ]);
  const profileById = new Map(profiles.map((p) => [p._id.toString(), p]));
  const areaById = new Map(areas.map((a) => [a._id.toString(), a]));
  const catById = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const out = new Map<string, LearnerSource>();
  for (const r of requests) {
    const p = profileById.get(r.learnerProfileId.toString());
    const a = areaById.get(r.areaId.toString());
    const centre = (a?.center as { coordinates?: number[] } | undefined)?.coordinates ?? [0, 0];
    out.set(r._id.toString(), {
      requestId: r._id.toString(),
      learnerUserId: r.learnerUserId.toString(),
      name: p?.name ?? '',
      ageBand: p?.ageBand ?? '',
      contactPhone: p?.contactPhone ?? '',
      contactEmail: p?.contactEmail ?? '',
      accessibilityNeeds: p?.accessibilityNeeds ?? [],
      areaId: r.areaId.toString(),
      areaName: a?.name ?? '',
      areaCenter: [centre[0] ?? 0, centre[1] ?? 0],
      location: [r.location.coordinates[0] ?? 0, r.location.coordinates[1] ?? 0],
      categoryName: catById.get(r.categoryId.toString()) ?? '',
      windows: (r.windows ?? []).map((w) => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
      startMonth: r.startMonth,
      durationMonths: r.durationMonths,
      status: r.status,
    });
  }
  return out;
}

/** The viewer's relation to an allocation, or 'none'. */
export function relationTo(user: SessionUser, alloc: AllocationLean): 'provider' | 'spaceGiver' | 'none' {
  if (alloc.providerUserId.toString() === user.id) return 'provider';
  if (alloc.spaceOwnerUserId.toString() === user.id) return 'spaceGiver';
  return 'none';
}

/** Roster for an allocation, redacted by stage through learnerViewFor. */
export async function listRoster(user: SessionUser, allocationId: Id): Promise<RosterDto> {
  const alloc = await Allocation.findById(allocationId).lean<AllocationLean>();
  if (!alloc) throw notFound('Allocation');
  const relation = relationTo(user, alloc);
  if (!isAdmin(user) && relation === 'none') throw forbidden();
  const offering = await CourseOffering.findById(alloc.offeringId).select('batchSize').lean<OfferingLean>();
  const rows = await Enrollment.find({ allocationId, status: { $in: ACTIVE_ENROLLMENT_STATUSES } })
    .sort({ status: 1, waitlistRank: 1, createdAt: 1 })
    .lean<EnrollmentLean[]>();
  const sources = await learnerSources(rows);
  const viewer = { id: user.id, role: user.role };
  const entries: RosterEntryDto[] = rows.map((e) => {
    const src = sources.get(e.requestId.toString());
    return {
      enrollmentId: e._id.toString(),
      status: e.status,
      waitlistRank: e.status === 'Waitlisted' ? (e.waitlistRank ?? null) : null,
      offerExpiresAt: e.offerExpiresAt ? new Date(e.offerExpiresAt).toISOString() : null,
      learner: src ? learnerViewFor(viewer, src, stageFromEnrollment(e.status), relation) : null,
    };
  });
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    allocationId: alloc._id.toString(),
    batchSize: offering?.batchSize ?? 0,
    counts: { proposed: count('Proposed'), offered: count('Offered'), accepted: count('Accepted'), waitlisted: count('Waitlisted') },
    entries,
  };
}
