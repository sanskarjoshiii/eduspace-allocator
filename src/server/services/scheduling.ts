// Schedule generator (PLAN 4.6): weekly sessions across the course duration,
// conflict-free per space. Dates are IST calendar dates stored as UTC midnight.

import { Types } from 'mongoose';
import type { SessionUser } from '@/server/auth/session';
import { Allocation, CourseOffering, Enrollment, Schedule, Space } from '@/server/models';
import { adminIds } from '@/server/notifications/notify';
import { badRequest, forbidden, isAdmin } from '@/server/http';
import { formatDate } from '@/lib/format';
import { logger } from '@/lib/logger';
import { baseVars, loadAllocation, loadAllocationContext } from '@/server/worker/context';
import { addCalendarDays, istDate, istToday, safeNotify, setAllocationStatus, setRequestStatus } from '@/server/worker/lifecycle';
import type { AllocationLean, EnrollmentLean, OfferingLean, ScheduleLean } from '@/server/worker/types';
import { toScheduleDto, type ScheduleDto } from '@/server/dto/schedule';

/** Schedule statuses that occupy the room. */
const OCCUPYING = ['Planned', 'Held'] as const;

export interface GenerateOptions {
  /** Number of weekly sessions; defaults to the offering's durationWeeks. */
  count?: number;
  /** Earliest calendar date (UTC midnight of the IST date). */
  from?: Date;
  now?: Date;
}

export interface GenerateResult {
  created: number;
  clashes: { date: Date; withCourse: string }[];
  firstDate: Date | null;
}

/** First date on or after `from` (UTC midnight) that falls on `dayOfWeek`. */
export function firstWeekday(from: Date, dayOfWeek: number): Date {
  const shift = (dayOfWeek - from.getUTCDay() + 7) % 7;
  return addCalendarDays(from, shift);
}

/**
 * Writes the weekly sessions for an allocation. Each date is checked against every
 * other non-cancelled session on the same space: a clash is not double-booked; the new
 * session is stored as Moved with "Clash with <course>" and flagged to admins and the provider.
 */
export async function generateSchedules(alloc: AllocationLean, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const offering = await CourseOffering.findById(alloc.offeringId).lean<OfferingLean>();
  if (!offering) throw badRequest('The offering for this allocation no longer exists.');
  const count = opts.count ?? offering.durationWeeks;
  const today = istToday(opts.now);
  const startCandidates = [istDate(new Date(offering.startDate)), today, ...(opts.from ? [opts.from] : [])];
  const start = new Date(Math.max(...startCandidates.map((d) => d.getTime())));
  const first = firstWeekday(start, alloc.session.dayOfWeek);
  const { startTime, endTime } = alloc.session;

  const dates = Array.from({ length: count }, (_, i) => addCalendarDays(first, i * 7));
  const others = await Schedule.find({
    spaceId: alloc.spaceId,
    date: { $in: dates },
    status: { $in: OCCUPYING },
    allocationId: { $ne: alloc._id },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  }).lean<ScheduleLean[]>();
  const titles = new Map(
    (await CourseOffering.find({ _id: { $in: [...new Set(others.map((o) => o.offeringId.toString()))] } }).select('title').lean()).map((o) => [
      o._id.toString(),
      o.title,
    ]),
  );
  const clashByDate = new Map(others.map((o) => [o.date.getTime(), titles.get(o.offeringId.toString()) ?? 'another class']));

  const clashes: GenerateResult['clashes'] = [];
  const docs = dates.map((date) => {
    const withCourse = clashByDate.get(date.getTime());
    if (withCourse) clashes.push({ date, withCourse });
    return {
      allocationId: alloc._id,
      spaceId: alloc.spaceId,
      offeringId: alloc.offeringId,
      date,
      startTime,
      endTime,
      status: withCourse ? 'Moved' : 'Planned',
      note: withCourse ? `Clash with ${withCourse}` : '',
    };
  });
  if (docs.length > 0) await Schedule.insertMany(docs);

  if (clashes.length > 0) {
    const c = await loadAllocationContext(alloc);
    const admins = await adminIds();
    for (const clash of clashes) {
      await safeNotify({
        type: 'schedule.clash',
        userIds: [...admins, alloc.providerUserId],
        vars: { ...baseVars(c), date: formatDate(clash.date) },
        related: { type: 'Allocation', id: alloc._id },
        href: `/allocations/${alloc._id.toString()}`,
      });
    }
    logger.warn('schedule.clash', { allocationId: alloc._id.toString(), clashes: clashes.length });
  }
  return { created: docs.length, clashes, firstDate: dates[0] ?? null };
}

/**
 * Called after an acceptance (and after a reallocation move). The first acceptance on a
 * confirmed allocation generates the schedule and moves the allocation to Scheduled;
 * later acceptances only move the learner's request to Scheduled.
 */
export async function ensureScheduled(
  allocationId: Types.ObjectId | string,
  actor: SessionUser | null,
  opts: { newlyAcceptedLearnerId?: Types.ObjectId | string; count?: number; now?: Date; retried?: boolean } = {},
): Promise<{ generated: boolean }> {
  const alloc = await loadAllocation(allocationId);
  const accepted = await Enrollment.find({ allocationId: alloc._id, status: 'Accepted' }).lean<EnrollmentLean[]>();
  if (accepted.length === 0) return { generated: false };
  const requestIds = accepted.map((e) => e.requestId);
  const c = await loadAllocationContext(alloc);
  const href = `/allocations/${alloc._id.toString()}`;
  const related = { type: 'Allocation', id: alloc._id };

  if (alloc.status === 'ConfirmedByProvider') {
    // The conditional status change makes this safe against two first acceptances at once.
    let scheduled: AllocationLean;
    try {
      scheduled = await setAllocationStatus(alloc._id, 'Scheduled', { actor, note: 'Schedule generated after the first acceptance' });
    } catch (err) {
      // Someone else scheduled it a moment ago: fall through to the "already scheduled" path once.
      if (opts.retried) throw err;
      return ensureScheduled(allocationId, actor, { ...opts, retried: true });
    }
    const existing = await Schedule.countDocuments({ allocationId: alloc._id, status: { $in: OCCUPYING } });
    const result = existing === 0 ? await generateSchedules(scheduled, { count: opts.count, now: opts.now }) : { created: existing, firstDate: null };
    const first = result.firstDate ?? (await Schedule.findOne({ allocationId: alloc._id }).sort({ date: 1 }).lean<ScheduleLean>())?.date ?? null;
    await setRequestStatus(requestIds, 'Scheduled', { actor, onlyFrom: ['Accepted'] });
    const vars = { ...baseVars(c), startDate: formatDate(first), sessionCount: result.created };
    await safeNotify({ type: 'schedule.created', userIds: accepted.map((e) => e.learnerUserId), vars, related, href: '/schedule' });
    await safeNotify({ type: 'schedule.created', userIds: [alloc.providerUserId, alloc.spaceOwnerUserId], vars, related, href });
    return { generated: existing === 0 };
  }

  if (alloc.status === 'Scheduled' || alloc.status === 'Active') {
    await setRequestStatus(requestIds, 'Scheduled', { actor, onlyFrom: ['Accepted'] });
    if (opts.newlyAcceptedLearnerId) {
      const first = await Schedule.findOne({ allocationId: alloc._id, status: { $in: OCCUPYING }, date: { $gte: istToday(opts.now) } })
        .sort({ date: 1 })
        .lean<ScheduleLean>();
      const count = await Schedule.countDocuments({ allocationId: alloc._id, status: { $in: OCCUPYING } });
      await safeNotify({
        type: 'schedule.created',
        userIds: [opts.newlyAcceptedLearnerId],
        vars: { ...baseVars(c), startDate: formatDate(first?.date), sessionCount: count },
        related,
        href: '/schedule',
      });
    }
  }
  return { generated: false };
}

/** Marks future sessions of an allocation as Moved (or Cancelled) and returns how many. */
export async function retireFutureSessions(
  allocationId: Types.ObjectId,
  status: 'Moved' | 'Cancelled',
  note: string,
  now?: Date,
): Promise<number> {
  const res = await Schedule.updateMany(
    { allocationId, status: 'Planned', date: { $gte: istToday(now) } },
    { $set: { status, note } },
  );
  return res.modifiedCount;
}

export interface ScheduleQuery {
  allocationId?: string;
  mine?: boolean;
  spaceId?: string;
  from?: Date;
  to?: Date;
}

/** Role-scoped sessions: learners see their accepted classes, providers their allocations, space givers their spaces. */
export async function listSchedules(user: SessionUser, q: ScheduleQuery): Promise<ScheduleDto[]> {
  const filter: Record<string, unknown> = {};
  const me = new Types.ObjectId(user.id);
  if (user.role === 'Learner') {
    const mine = await Enrollment.find({ learnerUserId: me, status: 'Accepted' }).select('allocationId').lean();
    const ids = mine.map((e) => e.allocationId?.toString()).filter((v): v is string => Boolean(v));
    if (q.allocationId && !ids.includes(q.allocationId)) throw forbidden();
    filter.allocationId = { $in: (q.allocationId ? [q.allocationId] : ids).map((id) => new Types.ObjectId(id)) };
  } else if (user.role === 'CourseProvider') {
    const allocs = await Allocation.find({ providerUserId: me }).select('_id').lean();
    const ids = allocs.map((a) => a._id.toString());
    if (q.allocationId && !ids.includes(q.allocationId)) throw forbidden();
    filter.allocationId = { $in: (q.allocationId ? [q.allocationId] : ids).map((id) => new Types.ObjectId(id)) };
  } else if (user.role === 'SpaceGiver') {
    const spaces = await Space.find({ ownerUserId: me }).select('_id').lean();
    const ids = spaces.map((s) => s._id.toString());
    if (q.spaceId && !ids.includes(q.spaceId)) throw forbidden();
    filter.spaceId = { $in: (q.spaceId ? [q.spaceId] : ids).map((id) => new Types.ObjectId(id)) };
    if (q.allocationId) filter.allocationId = new Types.ObjectId(q.allocationId);
  } else if (isAdmin(user)) {
    if (q.allocationId) filter.allocationId = new Types.ObjectId(q.allocationId);
    if (q.spaceId) filter.spaceId = new Types.ObjectId(q.spaceId);
  }
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: istDate(q.from) } : {}), ...(q.to ? { $lte: istDate(q.to) } : {}) };

  const rows = await Schedule.find(filter).sort({ date: 1, startTime: 1 }).limit(2000).lean<ScheduleLean[]>();
  const [offerings, spaces] = await Promise.all([
    CourseOffering.find({ _id: { $in: [...new Set(rows.map((r) => r.offeringId.toString()))] } }).select('title').lean(),
    Space.find({ _id: { $in: [...new Set(rows.map((r) => r.spaceId.toString()))] } }).select('name').lean(),
  ]);
  const titles = new Map(offerings.map((o) => [o._id.toString(), o.title]));
  const names = new Map(spaces.map((s) => [s._id.toString(), s.name]));
  return rows.map((r) => toScheduleDto(r, titles.get(r.offeringId.toString()) ?? '', names.get(r.spaceId.toString()) ?? ''));
}
