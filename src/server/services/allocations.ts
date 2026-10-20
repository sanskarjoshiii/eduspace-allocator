// Allocation actions and reads (PLAN 4.2, 4.3, 3.15): approve, reject, confirm, admin
// override, and role-scoped lists and details. Ordering is enforced: a space approves
// (or auto-approves) before the provider can confirm.

import { Types } from 'mongoose';
import { ALLOCATION_LABEL, SEAT_HOLDING_ENROLLMENT_STATUSES, type AllocationStatus, type ApprovalMode } from '@/lib/domain';
import { formatWindow } from '@/lib/format';
import type { SessionUser } from '@/server/auth/session';
import { conflict, forbidden, isAdmin, notFound, pageMeta } from '@/server/http';
import {
  Allocation,
  Area,
  CourseCategory,
  CourseOffering,
  Enrollment,
  Partner,
  Schedule,
  Space,
  User,
} from '@/server/models';
import { audit } from '@/server/services/audit';
import { emitEvent } from '@/server/services/events';
import {
  toAllocationListItem,
  type AllocationDetailDto,
  type AllocationListItemDto,
  type LearnerAllocationDto,
  type SeatCountsDto,
} from '@/server/dto/allocation';
import { toScheduleDto } from '@/server/dto/schedule';
import { learnerViewFor, stageFromEnrollment, type LearnerView } from '@/server/dto/privacy';
import type { AllocationListQuery, AllocationOverrideBody } from '@/schemas/allocation';
import { baseVars, loadAllocation, loadAllocationContext } from '@/server/worker/context';
import { ACTIVE_ENROLLMENT_STATUSES, safeNotify, setAllocationStatus, setRequestStatus } from '@/server/worker/lifecycle';
import type { AllocationLean, EnrollmentLean, OfferingLean, ScheduleLean, SpaceLean } from '@/server/worker/types';
import { cancelEnrollmentsOfAllocation, learnerSources, offerProposedEnrollments, relationTo } from './enrollments';
import { ensureScheduled, retireFutureSessions } from './scheduling';
import { completeReallocationMove, moveAllocation, reopenOfferingIfIdle } from './reallocation';

type Id = Types.ObjectId;
const href = (id: Id) => `/allocations/${id.toString()}`;

// ---- Reads -----------------------------------------------------------------------------

async function seatCounts(allocIds: Id[]): Promise<Map<string, Omit<SeatCountsDto, 'batchSize' | 'taken'>>> {
  const rows = await Enrollment.aggregate<{ _id: { a: Id; s: string }; n: number }>([
    { $match: { allocationId: { $in: allocIds }, status: { $in: [...SEAT_HOLDING_ENROLLMENT_STATUSES, 'Waitlisted'] } } },
    { $group: { _id: { a: '$allocationId', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const out = new Map<string, Omit<SeatCountsDto, 'batchSize' | 'taken'>>();
  for (const r of rows) {
    const k = r._id.a.toString();
    const cur = out.get(k) ?? { proposed: 0, offered: 0, accepted: 0, waitlisted: 0 };
    const key = r._id.s.toLowerCase() as 'proposed' | 'offered' | 'accepted' | 'waitlisted';
    cur[key] = r.n;
    out.set(k, cur);
  }
  return out;
}

async function listItems(allocs: AllocationLean[]): Promise<AllocationListItemDto[]> {
  const [offerings, spaces, counts] = await Promise.all([
    CourseOffering.find({ _id: { $in: allocs.map((a) => a.offeringId) } }).lean<OfferingLean[]>(),
    Space.find({ _id: { $in: allocs.map((a) => a.spaceId) } }).lean<SpaceLean[]>(),
    seatCounts(allocs.map((a) => a._id)),
  ]);
  const [areas, cats] = await Promise.all([
    Area.find({ _id: { $in: spaces.map((s) => s.areaId) } }).select('name').lean(),
    CourseCategory.find({ _id: { $in: offerings.map((o) => o.categoryId) } }).select('name').lean(),
  ]);
  const off = new Map(offerings.map((o) => [o._id.toString(), o]));
  const sp = new Map(spaces.map((s) => [s._id.toString(), s]));
  const areaName = new Map(areas.map((a) => [a._id.toString(), a.name]));
  const catName = new Map(cats.map((c) => [c._id.toString(), c.name]));
  return allocs.map((a) => {
    const o = off.get(a.offeringId.toString());
    const s = sp.get(a.spaceId.toString());
    const c = counts.get(a._id.toString()) ?? { proposed: 0, offered: 0, accepted: 0, waitlisted: 0 };
    return toAllocationListItem(a, {
      courseTitle: o?.title ?? '',
      categoryName: o ? (catName.get(o.categoryId.toString()) ?? '') : '',
      spaceName: s?.name ?? '',
      areaName: s ? (areaName.get(s.areaId.toString()) ?? '') : '',
      approvalMode: (s?.policy?.approvalMode ?? 'auto') as ApprovalMode,
      seats: { batchSize: o?.batchSize ?? 0, ...c, taken: c.proposed + c.offered + c.accepted },
    });
  });
}

async function learnerItems(user: SessionUser, allocs: AllocationLean[]): Promise<LearnerAllocationDto[]> {
  const items = await listItems(allocs);
  const mine = await Enrollment.find({ learnerUserId: new Types.ObjectId(user.id), allocationId: { $in: allocs.map((a) => a._id) } })
    .sort({ createdAt: -1 })
    .lean<EnrollmentLean[]>();
  return items.map((i) => {
    const e = mine.find((m) => m.allocationId?.toString() === i.id);
    return {
      id: i.id,
      courseTitle: i.courseTitle,
      spaceName: i.spaceName,
      areaName: i.areaName,
      session: i.session,
      sessionLabel: i.sessionLabel,
      status: i.status,
      statusLabel: i.statusLabel,
      myEnrollment: e
        ? {
            id: e._id.toString(),
            status: e.status,
            offerExpiresAt: e.offerExpiresAt ? new Date(e.offerExpiresAt).toISOString() : null,
            waitlistRank: e.status === 'Waitlisted' ? (e.waitlistRank ?? null) : null,
          }
        : null,
    };
  });
}

export interface AllocationPage<T> {
  items: T[];
  meta: ReturnType<typeof pageMeta>;
}

/** Role-scoped list: admins see all (with filters), space givers their spaces, providers their offerings, learners where they hold a place. */
export async function listAllocations(
  user: SessionUser,
  q: AllocationListQuery,
): Promise<AllocationPage<AllocationListItemDto> | AllocationPage<LearnerAllocationDto>> {
  const me = new Types.ObjectId(user.id);
  const filter: Record<string, unknown> = {};
  if (user.role === 'SpaceGiver') filter.spaceOwnerUserId = me;
  else if (user.role === 'CourseProvider') filter.providerUserId = me;
  else if (user.role === 'Learner') {
    const ids = await Enrollment.distinct('allocationId', { learnerUserId: me, allocationId: { $ne: null } });
    filter._id = { $in: ids };
  }
  if (q.status) filter.status = Array.isArray(q.status) ? { $in: q.status } : q.status;
  if (q.runId) filter.runId = new Types.ObjectId(q.runId);
  if (q.offeringId) filter.offeringId = new Types.ObjectId(q.offeringId);
  if (q.spaceId) filter.spaceId = new Types.ObjectId(q.spaceId);

  const [total, rows] = await Promise.all([
    Allocation.countDocuments(filter),
    Allocation.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean<AllocationLean[]>(),
  ]);
  const meta = pageMeta(total, q.page, q.pageSize);
  if (user.role === 'Learner') return { items: await learnerItems(user, rows), meta };
  return { items: await listItems(rows), meta };
}

function canSee(user: SessionUser, a: AllocationLean): boolean {
  return isAdmin(user) || a.providerUserId.toString() === user.id || a.spaceOwnerUserId.toString() === user.id;
}

/** Detail. Learners get only their own place on it; providers and space givers a cohort redacted by stage. */
export async function getAllocationDetail(user: SessionUser, id: Id): Promise<AllocationDetailDto | LearnerAllocationDto> {
  const a = await Allocation.findById(id).lean<AllocationLean>();
  if (!a) throw notFound('Allocation');
  if (user.role === 'Learner') {
    const holds = await Enrollment.exists({ allocationId: a._id, learnerUserId: new Types.ObjectId(user.id) });
    if (!holds) throw notFound('Allocation');
    return (await learnerItems(user, [a]))[0]!;
  }
  if (!canSee(user, a)) throw notFound('Allocation');

  const [item] = await listItems([a]);
  const c = await loadAllocationContext(a);
  const [category, providerPartner, providerUser, ownerPartner, ownerUser, schedules, replacements, altSpaces] = await Promise.all([
    CourseCategory.findById(c.offering.categoryId).select('name').lean(),
    Partner.findOne({ userId: a.providerUserId }).select('name').lean(),
    User.findById(a.providerUserId).select('name').lean(),
    Partner.findOne({ userId: a.spaceOwnerUserId }).select('name').lean(),
    User.findById(a.spaceOwnerUserId).select('name').lean(),
    Schedule.find({ allocationId: a._id }).sort({ date: 1 }).lean<ScheduleLean[]>(),
    Allocation.find({ replacesAllocationId: a._id }).sort({ createdAt: -1 }).lean<AllocationLean[]>(),
    Space.find({ _id: { $in: (a.rejectedAlternatives ?? []).map((r) => r.spaceId) } }).select('name').lean(),
  ]);
  const replacementSpaces = await Space.find({ _id: { $in: replacements.map((r) => r.spaceId) } }).select('name').lean();
  const altName = new Map(altSpaces.map((s) => [s._id.toString(), s.name]));

  // Cohort: aggregate by area for everyone allowed here; identities only via learnerViewFor.
  // A replacement proposal shows the cohort of the allocation it replaces.
  const cohortAllocId = a.replacesAllocationId && ['Proposed', 'ApprovedBySpace'].includes(a.status) ? a.replacesAllocationId : a._id;
  const enrollments = await Enrollment.find({ allocationId: cohortAllocId, status: { $in: ACTIVE_ENROLLMENT_STATUSES } }).lean<EnrollmentLean[]>();
  const sources = await learnerSources(enrollments);
  const relation = relationTo(user, a);
  const viewer = { id: user.id, role: user.role };
  const byArea = new Map<string, number>();
  const learners: LearnerView[] = [];
  for (const e of enrollments) {
    const src = sources.get(e.requestId.toString());
    if (!src) continue;
    if (e.status !== 'Waitlisted') byArea.set(src.areaName, (byArea.get(src.areaName) ?? 0) + 1);
    const view = learnerViewFor(viewer, src, stageFromEnrollment(e.status), relation);
    if (view) learners.push(view);
  }
  const isProvider = a.providerUserId.toString() === user.id;
  const isOwner = a.spaceOwnerUserId.toString() === user.id;
  return {
    ...item!,
    categoryName: category?.name ?? item!.categoryName,
    offering: {
      id: c.offering._id.toString(),
      title: c.offering.title,
      categoryName: category?.name ?? '',
      audience: c.offering.audience,
      batchSize: c.offering.batchSize,
      sessionMinutes: c.offering.sessionMinutes,
      durationWeeks: c.offering.durationWeeks,
      startDate: new Date(c.offering.startDate).toISOString(),
    },
    space: {
      id: c.space._id.toString(),
      name: c.space.name,
      address: c.space.address ?? '',
      areaName: c.areaName,
      location: [c.space.location.coordinates[0] ?? 0, c.space.location.coordinates[1] ?? 0],
      seatCapacity: c.space.seatCapacity,
      approvalMode: (c.space.policy?.approvalMode ?? 'auto') as ApprovalMode,
    },
    providerName: providerPartner?.name ?? providerUser?.name ?? '',
    spaceGiverName: ownerPartner?.name ?? ownerUser?.name ?? '',
    breakdown: a.scoreBreakdown ?? [],
    constraints: a.constraints ?? [],
    rejectedAlternatives: (a.rejectedAlternatives ?? []).map((r) => ({
      spaceId: r.spaceId.toString(),
      spaceName: altName.get(r.spaceId.toString()) ?? r.spaceName ?? '',
      session: r.session ?? null,
      sessionLabel: r.session ? formatWindow(r.session) : '',
      failedConstraint: r.failedConstraint ?? null,
      reason: r.reason ?? '',
      score: r.score ?? null,
      distanceKm: r.distanceKm ?? null,
    })),
    statusHistory: (a.statusHistory ?? []).map((h) => ({
      status: h.status,
      label: ALLOCATION_LABEL[h.status as AllocationStatus] ?? h.status,
      at: new Date(h.at).toISOString(),
      note: h.note ?? '',
    })),
    overrideNote: a.overrideNote ?? '',
    cohort: { headcount: [...byArea.values()].reduce((x, y) => x + y, 0), byArea: [...byArea.entries()].map(([areaName, count]) => ({ areaName, count })), learners },
    schedules: schedules.map((s) => toScheduleDto(s, c.offering.title, c.space.name)),
    replacements: replacements.map((r) => ({
      id: r._id.toString(),
      spaceName: replacementSpaces.find((s) => s._id.equals(r.spaceId))?.name ?? '',
      status: r.status,
    })),
    actions: {
      approve: (isOwner || isAdmin(user)) && a.status === 'Proposed',
      reject: (isOwner || isAdmin(user)) && (a.status === 'Proposed' || a.status === 'ApprovedBySpace'),
      confirm: (isProvider || isAdmin(user)) && a.status === 'ApprovedBySpace',
      override: isAdmin(user),
    },
  };
}

// ---- Actions ---------------------------------------------------------------------------

function assertSpaceGiver(user: SessionUser, a: AllocationLean): void {
  if (!isAdmin(user) && a.spaceOwnerUserId.toString() !== user.id) throw forbidden('Only the space giver of this space can do this.');
}
function assertProvider(user: SessionUser, a: AllocationLean): void {
  if (!isAdmin(user) && a.providerUserId.toString() !== user.id) throw forbidden('Only the course provider of this offering can do this.');
}

async function doApprove(a: AllocationLean, actor: SessionUser, note: string | undefined, action: string): Promise<void> {
  if (a.status !== 'Proposed') throw conflict(`Only a proposed allocation can be approved; this one is ${ALLOCATION_LABEL[a.status]}.`);
  await setAllocationStatus(a._id, 'ApprovedBySpace', { actor, action, note: note || 'Approved by the space giver', set: { approvedAt: new Date() } });
  const c = await loadAllocationContext(a);
  await safeNotify({ type: 'allocation.approved', userIds: [a.providerUserId], vars: { ...baseVars(c), approvalNote: '' }, related: { type: 'Allocation', id: a._id }, href: href(a._id) });
}

async function doReject(a: AllocationLean, actor: SessionUser, note: string | undefined, action: string): Promise<void> {
  await setAllocationStatus(a._id, 'Rejected', { actor, action, note: note || 'Declined by the space giver' });
  const { requestIds } = await cancelEnrollmentsOfAllocation(a._id, actor, 'The space declined this class');
  await setRequestStatus(requestIds, 'Analysed', { actor, onlyFrom: ['Matched', 'Waitlisted', 'Offered'], note: 'Back to Smart Allocation after the space declined' });
  await reopenOfferingIfIdle(a.offeringId);
  await emitEvent('offering.saved', a.offeringId, { reason: 'allocation.rejected', allocationId: a._id.toString() });
  const c = await loadAllocationContext(a);
  await safeNotify({ type: 'allocation.rejected', userIds: [a.providerUserId], vars: baseVars(c), related: { type: 'Allocation', id: a._id }, href: href(a._id) });
}

async function doConfirm(a: AllocationLean, actor: SessionUser, note: string | undefined, action: string): Promise<void> {
  if (a.status === 'Proposed') throw conflict('The space has not approved this yet.');
  if (a.status !== 'ApprovedBySpace') throw conflict(`Only an approved allocation can be confirmed; this one is ${ALLOCATION_LABEL[a.status]}.`);
  if (a.replacesAllocationId) {
    const old = await Allocation.findById(a.replacesAllocationId).select('status').lean<AllocationLean>();
    if (!old || old.status !== 'NeedsReallocation') throw conflict('The class this proposal replaces no longer needs a new space.');
  }
  const confirmed = await setAllocationStatus(a._id, 'ConfirmedByProvider', { actor, action, note: note || 'Confirmed by the course provider', set: { confirmedAt: new Date() } });
  const move = a.replacesAllocationId ? await completeReallocationMove(confirmed, actor) : { remainingSessions: undefined };
  await offerProposedEnrollments(a._id, actor);
  const c = await loadAllocationContext(confirmed);
  await safeNotify({ type: 'allocation.confirmed', userIds: [a.spaceOwnerUserId], vars: baseVars(c), related: { type: 'Allocation', id: a._id }, href: href(a._id) });
  await ensureScheduled(a._id, actor, { count: move.remainingSessions });
}

/** Cancels a live allocation (override): learners are released back to the engine, future sessions cancelled. */
async function doCancel(a: AllocationLean, actor: SessionUser, note: string): Promise<void> {
  await setAllocationStatus(a._id, 'Cancelled', { actor, action: 'override', note });
  const { requestIds, learnerIds } = await cancelEnrollmentsOfAllocation(a._id, actor, `Cancelled by an administrator: ${note}`);
  await setRequestStatus(requestIds, 'Analysed', { actor, note: 'Back to Smart Allocation after an administrator cancelled the class' });
  await retireFutureSessions(a._id, 'Cancelled', `Cancelled by an administrator: ${note}`);
  await reopenOfferingIfIdle(a.offeringId);
  await emitEvent('offering.saved', a.offeringId, { reason: 'allocation.cancelled', allocationId: a._id.toString() });
  const c = await loadAllocationContext(a);
  await safeNotify({
    type: 'schedule.changed',
    userIds: [...learnerIds, a.providerUserId, a.spaceOwnerUserId],
    vars: { ...baseVars(c), change: 'The class was cancelled by an administrator. Smart Allocation will look for another option.' },
    related: { type: 'Allocation', id: a._id },
    href: href(a._id),
  });
}

export async function approveAllocation(user: SessionUser, id: Id, note?: string): Promise<void> {
  const a = await loadAllocation(id);
  assertSpaceGiver(user, a);
  await doApprove(a, user, note, 'approve');
}

export async function rejectAllocation(user: SessionUser, id: Id, note?: string): Promise<void> {
  const a = await loadAllocation(id);
  assertSpaceGiver(user, a);
  if (a.status !== 'Proposed' && a.status !== 'ApprovedBySpace') {
    throw conflict(`Only a proposed or approved allocation can be declined; this one is ${ALLOCATION_LABEL[a.status]}.`);
  }
  await doReject(a, user, note, 'reject');
}

export async function confirmAllocation(user: SessionUser, id: Id, note?: string): Promise<void> {
  const a = await loadAllocation(id);
  assertProvider(user, a);
  await doConfirm(a, user, note, 'confirm');
}

/**
 * Administrator override. Every override is audited with the note (action 'override').
 * 'confirm' on a Proposed allocation approves it on the space's behalf first.
 */
export async function overrideAllocation(user: SessionUser, id: Id, body: AllocationOverrideBody): Promise<void> {
  if (!isAdmin(user)) throw forbidden('Only administrators can override allocations.');
  const a = await loadAllocation(id);
  const note = `Override: ${body.note}`;
  await audit({ actor: user, action: 'override', entity: 'Allocation', entityId: a._id, ownerUserId: a.providerUserId, diff: { action: body.action, note: body.note, status: a.status } });
  await Allocation.updateOne({ _id: a._id }, { $set: { overrideNote: body.note } });
  switch (body.action) {
    case 'approve':
      return doApprove(a, user, note, 'override');
    case 'confirm': {
      if (a.status === 'Proposed') await doApprove(a, user, note, 'override');
      return doConfirm(await loadAllocation(id), user, note, 'override');
    }
    case 'reject':
      if (a.status !== 'Proposed' && a.status !== 'ApprovedBySpace') throw conflict('Only a proposed or approved allocation can be rejected; cancel it instead.');
      return doReject(a, user, note, 'override');
    case 'cancel':
      return doCancel(a, user, body.note);
    case 'move':
      return moveAllocation(a, user, { spaceId: body.spaceId, session: body.session }, body.note);
  }
}

