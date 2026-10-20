// Guarded status changes for allocations, enrollments and requests, plus small shared
// helpers (notification wrapper, IST calendar dates, labels). Every status change goes
// through canTransition, pushes statusHistory and writes an audit entry.

import { Types, type ClientSession } from 'mongoose';
import {
  ALLOCATION_LABEL,
  ALLOCATION_TRANSITIONS,
  ENROLLMENT_TRANSITIONS,
  canTransition,
  type AllocationStatus,
  type EnrollmentStatus,
  type RequestStatus,
} from '@/lib/domain';
import { formatWindow } from '@/lib/format';
import { logger } from '@/lib/logger';
import { Allocation, Enrollment, LearningRequest } from '@/server/models';
import { audit } from '@/server/services/audit';
import { HttpError, conflict } from '@/server/http';
import type { SessionUser } from '@/server/auth/session';
import { notify, type NotifyInput } from '@/server/notifications/notify';
import type { AllocationLean, EnrollmentLean, WindowDoc } from './types';

type Id = Types.ObjectId;
const oid = (v: Id | string): Id => (typeof v === 'string' ? new Types.ObjectId(v) : v);

export interface TransitionOptions {
  actor?: SessionUser | null;
  note?: string;
  /** Extra fields to set with the status. */
  set?: Record<string, unknown>;
  session?: ClientSession | null;
  /** Audit action; defaults to 'update'. */
  action?: string;
  /** Skip the per-change audit entry (bulk engine writes are audited once per run). */
  skipAudit?: boolean;
}

function historyEntry(status: string, opts: TransitionOptions) {
  return { status, at: new Date(), by: opts.actor?.id ? new Types.ObjectId(opts.actor.id) : null, note: opts.note ?? '' };
}

/**
 * Moves an allocation to `to` when the lifecycle allows it. The write is conditional on
 * the status read, so two concurrent changes cannot both succeed. Throws 409 otherwise.
 */
export async function setAllocationStatus(id: Id | string, to: AllocationStatus, opts: TransitionOptions = {}): Promise<AllocationLean> {
  const current = await Allocation.findById(id).session(opts.session ?? null).lean<AllocationLean>();
  if (!current) throw new HttpError(404, 'not_found', 'Allocation not found.');
  if (!canTransition(ALLOCATION_TRANSITIONS, current.status, to)) {
    throw conflict(`This allocation is ${ALLOCATION_LABEL[current.status]} and cannot become ${ALLOCATION_LABEL[to]}.`, {
      from: current.status,
      to,
    });
  }
  return forceAllocationStatus(current, to, opts);
}

/**
 * Writes an allocation status without the lifecycle check. Only for the documented
 * exception: restoring the status an allocation held before "Needs reallocation".
 */
export async function forceAllocationStatus(current: AllocationLean, to: AllocationStatus, opts: TransitionOptions = {}): Promise<AllocationLean> {
  const updated = await Allocation.findOneAndUpdate(
    { _id: current._id, status: current.status },
    { $set: { status: to, ...(opts.set ?? {}) }, $push: { statusHistory: historyEntry(to, opts) } },
    { new: true, session: opts.session ?? undefined },
  ).lean<AllocationLean>();
  if (!updated) throw conflict('This allocation changed while you were working on it. Reload and try again.');
  if (!opts.skipAudit) {
    await audit({
      actor: opts.actor ?? null,
      action: opts.action ?? 'update',
      entity: 'Allocation',
      entityId: current._id,
      ownerUserId: current.providerUserId,
      diff: { status: { from: current.status, to }, ...(opts.note ? { note: opts.note } : {}) },
      session: opts.session,
    });
  }
  return updated;
}

/** Moves an enrollment along ENROLLMENT_TRANSITIONS. Throws 409 for an illegal change. */
export async function setEnrollmentStatus(
  idOrDoc: Id | string | EnrollmentLean,
  to: EnrollmentStatus,
  opts: TransitionOptions = {},
): Promise<EnrollmentLean> {
  const current =
    typeof idOrDoc === 'object' && 'status' in idOrDoc
      ? idOrDoc
      : await Enrollment.findById(idOrDoc).session(opts.session ?? null).lean<EnrollmentLean>();
  if (!current) throw new HttpError(404, 'not_found', 'Enrollment not found.');
  if (!canTransition(ENROLLMENT_TRANSITIONS, current.status, to)) {
    throw conflict(`This enrollment is ${current.status} and cannot become ${to}.`, { from: current.status, to });
  }
  const updated = await Enrollment.findOneAndUpdate(
    { _id: current._id, status: current.status },
    { $set: { status: to, ...(opts.set ?? {}) }, $push: { statusHistory: historyEntry(to, opts) } },
    { new: true, session: opts.session ?? undefined },
  ).lean<EnrollmentLean>();
  if (!updated) throw conflict('This enrollment changed while you were working on it. Reload and try again.');
  if (!opts.skipAudit) {
    await audit({
      actor: opts.actor ?? null,
      action: opts.action ?? 'update',
      entity: 'Enrollment',
      entityId: current._id,
      ownerUserId: current.learnerUserId,
      diff: { status: { from: current.status, to }, ...(opts.note ? { note: opts.note } : {}) },
      session: opts.session,
    });
  }
  return updated;
}

/** Request statuses that are final for a learner; propagation never overwrites them. */
const FINAL_REQUEST_STATUSES: RequestStatus[] = ['Cancelled', 'Completed'];

/** Propagates a request status (README section 8). Final statuses are never overwritten. */
export async function setRequestStatus(
  ids: (Id | string)[],
  to: RequestStatus,
  opts: TransitionOptions & { onlyFrom?: RequestStatus[] } = {},
): Promise<number> {
  if (ids.length === 0) return 0;
  const filter: Record<string, unknown> = {
    _id: { $in: ids.map(oid) },
    status: opts.onlyFrom ? { $in: opts.onlyFrom } : { $nin: [...FINAL_REQUEST_STATUSES, to] },
  };
  const res = await LearningRequest.updateMany(filter, { $set: { status: to, ...(opts.set ?? {}) } }, { session: opts.session ?? undefined });
  if (!opts.skipAudit && res.modifiedCount > 0) {
    await audit({
      actor: opts.actor ?? null,
      action: opts.action ?? 'update',
      entity: 'LearningRequest',
      entityId: ids.length === 1 ? oid(ids[0]!) : null,
      ownerUserId: null,
      diff: { status: { to }, count: res.modifiedCount, ...(opts.note ? { note: opts.note } : {}) },
      session: opts.session,
    });
  }
  return res.modifiedCount;
}

/** notify() that never throws: a failed notification is logged, not surfaced. */
export async function safeNotify(input: NotifyInput): Promise<number> {
  try {
    return await notify(input);
  } catch (err) {
    logger.error('notify.failed', { type: input.type, message: (err as Error).message });
    return 0;
  }
}

/** "Sat 10:00–13:00". */
export const sessionLabel = (w: WindowDoc): string => formatWindow(w);

// ---- IST calendar dates -------------------------------------------------------------
// Schedules store each session's calendar date in Asia/Kolkata as UTC midnight of that
// date (2026-11-07 IST is stored as 2026-11-07T00:00:00Z). IST has no daylight saving,
// so the conversion is a fixed +05:30 shift.

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The IST calendar date of an instant, as UTC midnight. */
export function istDate(at: Date): Date {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** Today's IST calendar date as UTC midnight. */
export const istToday = (now: Date = new Date()): Date => istDate(now);

export const addCalendarDays = (d: Date, days: number): Date => new Date(d.getTime() + days * DAY_MS);

/** "2026-11-07" from a stored calendar date. */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** The instant a session starts: calendar date + "HH:mm" in IST. */
export function sessionInstant(date: Date, hhmm: string): Date {
  const [h = '0', m = '0'] = hhmm.split(':');
  return new Date(date.getTime() + (Number(h) * 60 + Number(m)) * 60_000 - IST_OFFSET_MS);
}

/** Allocation statuses with a live class (provider confirmed). */
export const CONFIRMED_STATUSES: readonly AllocationStatus[] = ['ConfirmedByProvider', 'Scheduled', 'Active'];
/** Allocations that still hold or may hold learners. */
export const LIVE_ALLOCATION_STATUSES: readonly AllocationStatus[] = [
  'Proposed', 'ApprovedBySpace', 'ConfirmedByProvider', 'Scheduled', 'Active', 'NeedsReallocation',
];
/** Enrollments that are still in play (hold a seat or a waitlist place). */
export const ACTIVE_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['Proposed', 'Offered', 'Accepted', 'Waitlisted'];
