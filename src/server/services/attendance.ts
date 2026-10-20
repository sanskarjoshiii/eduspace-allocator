import { Types } from 'mongoose';
import {
  Allocation, Area, AttendanceRecord, CourseCategory, CourseOffering, Enrollment, LearnerProfile, LearningRequest, Notification, Schedule,
} from '@/server/models';
import { badRequest, conflict, forbidden, notFound } from '@/server/http';
import { learnerViewFor, type LearnerSource, type LearnerView } from '@/server/dto/privacy';
import { notify } from '@/server/notifications/notify';
import type { AttendanceInput } from '@/schemas/attendance';
import type { SessionUser } from '@/server/auth/session';
import { audit } from './audit';
import { pointOf, round3 } from './insights';

export interface AttendanceSessionRow {
  scheduleId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  present: number;
  absent: number;
  marked: number;
  /** Each learner's mark for this session, so an edit starts from it. Null for Space Givers (counts only). */
  records: { enrollmentId: string; present: boolean }[] | null;
}

export interface AttendanceLearnerRow {
  enrollmentId: string;
  learner: LearnerView | null;
  attended: number;
  sessionsMarked: number;
  /** attended / sessionsMarked, 0..1; null when no session was marked. */
  rate: number | null;
}

export interface AttendanceReport {
  allocationId: string;
  offeringTitle: string;
  acceptedLearners: number;
  sessionsHeld: number;
  /** present / marked across all sessions, 0..1; null before any marking. */
  attendanceRate: number | null;
  sessions: AttendanceSessionRow[];
  /** Per-learner rates. Null for Space Givers, who get counts only. */
  learners: AttendanceLearnerRow[] | null;
}

/** Records attendance for one session of an allocation the user's offering owns (or any, for administrators). */
export async function recordAttendance(user: SessionUser, input: AttendanceInput): Promise<{ scheduleId: string; recorded: number; present: number }> {
  const schedule = await Schedule.findById(input.scheduleId).lean();
  if (!schedule) throw notFound('Session');
  const allocation = await Allocation.findById(schedule.allocationId).select('providerUserId offeringId spaceOwnerUserId').lean();
  if (!allocation) throw notFound('Allocation');
  if (user.role !== 'Administrator' && allocation.providerUserId.toString() !== user.id) {
    throw forbidden('Only the course provider can mark attendance.');
  }
  if (schedule.status === 'Cancelled' || schedule.status === 'Moved') throw conflict('This session was cancelled or moved, so attendance cannot be marked.');

  const accepted = await Enrollment.find({ allocationId: allocation._id, status: 'Accepted' }).select('_id learnerUserId').lean();
  const acceptedIds = new Set(accepted.map((e) => e._id.toString()));
  const unknown = input.records.filter((r) => !acceptedIds.has(r.enrollmentId));
  if (unknown.length > 0) {
    throw badRequest('Attendance can only be marked for learners who accepted a seat in this class.', { enrollmentIds: unknown.map((r) => r.enrollmentId) });
  }

  const markedBy = new Types.ObjectId(user.id);
  await AttendanceRecord.bulkWrite(
    input.records.map((r) => ({
      updateOne: {
        filter: { enrollmentId: new Types.ObjectId(r.enrollmentId), sessionDate: schedule.date },
        update: { $set: { present: r.present, markedBy, scheduleId: schedule._id, allocationId: allocation._id } },
        upsert: true,
      },
    })),
  );
  if (schedule.status !== 'Held') await Schedule.updateOne({ _id: schedule._id }, { $set: { status: 'Held' } });
  const present = input.records.filter((r) => r.present).length;
  await audit({
    actor: user,
    action: 'update',
    entity: 'Attendance',
    entityId: schedule._id,
    ownerUserId: allocation.providerUserId,
    diff: { allocationId: allocation._id.toString(), sessionDate: schedule.date, marked: input.records.length, present },
  });
  await promptRatingIfFinished(allocation._id, allocation.offeringId, accepted.map((e) => e.learnerUserId));
  return { scheduleId: schedule._id.toString(), recorded: input.records.length, present };
}

/** Once every remaining session of a class is held, asks its learners (once) to rate the course. */
async function promptRatingIfFinished(allocationId: Types.ObjectId, offeringId: Types.ObjectId, learnerIds: Types.ObjectId[]): Promise<void> {
  if (learnerIds.length === 0) return;
  const pending = await Schedule.countDocuments({ allocationId, status: 'Planned' });
  if (pending > 0) return;
  const already = await Notification.exists({ type: 'course.completed', relatedType: 'Allocation', relatedId: allocationId });
  if (already) return;
  const offering = await CourseOffering.findById(offeringId).select('title').lean();
  await notify({
    type: 'course.completed',
    userIds: learnerIds,
    vars: { courseTitle: offering?.title ?? 'your course' },
    related: { type: 'Allocation', id: allocationId },
    href: '/offers',
  });
}

/** Learner sources for accepted enrollments, for redaction through learnerViewFor. */
export async function learnerSources(enrollments: { _id: Types.ObjectId; requestId: Types.ObjectId; learnerUserId: Types.ObjectId; status: string }[]): Promise<Map<string, LearnerSource>> {
  const requests = await LearningRequest.find({ _id: { $in: enrollments.map((e) => e.requestId) } }).lean();
  const [profiles, areas, cats] = await Promise.all([
    LearnerProfile.find({ _id: { $in: requests.map((r) => r.learnerProfileId) } }).lean(),
    Area.find({ _id: { $in: requests.map((r) => r.areaId) } }).select('name center').lean(),
    CourseCategory.find({ _id: { $in: requests.map((r) => r.categoryId) } }).select('name').lean(),
  ]);
  const out = new Map<string, LearnerSource>();
  for (const e of enrollments) {
    const r = requests.find((x) => x._id.toString() === e.requestId.toString());
    if (!r) continue;
    const p = profiles.find((x) => x._id.toString() === r.learnerProfileId.toString());
    const a = areas.find((x) => x._id.toString() === r.areaId.toString());
    out.set(e._id.toString(), {
      requestId: r._id.toString(),
      learnerUserId: r.learnerUserId.toString(),
      name: p?.name ?? 'Learner',
      ageBand: p?.ageBand ?? '',
      contactPhone: p?.contactPhone ?? '',
      contactEmail: p?.contactEmail ?? '',
      accessibilityNeeds: p?.accessibilityNeeds ?? [],
      areaId: r.areaId.toString(),
      areaName: a?.name ?? '',
      areaCenter: pointOf(a?.center),
      location: pointOf(r.location),
      categoryName: cats.find((c) => c._id.toString() === r.categoryId.toString())?.name ?? '',
      windows: r.windows.map((w) => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
      startMonth: r.startMonth,
      durationMonths: r.durationMonths,
      status: r.status,
    });
  }
  return out;
}

/**
 * Attendance for one allocation. Providers see their accepted learners (redacted by stage);
 * Space Givers see session counts only; administrators see everything.
 */
export async function attendanceReport(user: SessionUser, allocationId: Types.ObjectId): Promise<AttendanceReport> {
  const allocation = await Allocation.findById(allocationId).select('providerUserId spaceOwnerUserId offeringId').lean();
  if (!allocation) throw notFound('Allocation');
  const isAdmin = user.role === 'Administrator';
  const isProvider = user.role === 'CourseProvider' && allocation.providerUserId.toString() === user.id;
  const isSpaceGiver = user.role === 'SpaceGiver' && allocation.spaceOwnerUserId.toString() === user.id;
  if (!isAdmin && !isProvider && !isSpaceGiver) throw forbidden();

  const [offering, schedules, records, accepted] = await Promise.all([
    CourseOffering.findById(allocation.offeringId).select('title').lean(),
    Schedule.find({ allocationId }).sort({ date: 1 }).lean(),
    AttendanceRecord.find({ allocationId }).select('enrollmentId sessionDate scheduleId present').lean(),
    Enrollment.find({ allocationId, status: 'Accepted' }).select('_id requestId learnerUserId status').lean(),
  ]);

  const dayKey = (d: Date) => new Date(d).toISOString();
  const sessions: AttendanceSessionRow[] = schedules.map((s) => {
    const rs = records.filter((r) => (r.scheduleId ? r.scheduleId.toString() === s._id.toString() : dayKey(r.sessionDate) === dayKey(s.date)));
    const present = rs.filter((r) => r.present).length;
    return {
      scheduleId: s._id.toString(),
      date: new Date(s.date).toISOString(),
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status ?? 'Planned',
      present,
      absent: rs.length - present,
      marked: rs.length,
      records: isSpaceGiver && !isAdmin ? null : rs.map((r) => ({ enrollmentId: r.enrollmentId.toString(), present: r.present })),
    };
  });
  const totalPresent = records.filter((r) => r.present).length;

  let learners: AttendanceLearnerRow[] | null = null;
  if (!isSpaceGiver || isAdmin) {
    const sources = await learnerSources(accepted);
    learners = accepted.map((e) => {
      const mine = records.filter((r) => r.enrollmentId.toString() === e._id.toString());
      const attended = mine.filter((r) => r.present).length;
      const src = sources.get(e._id.toString());
      return {
        enrollmentId: e._id.toString(),
        learner: src ? learnerViewFor({ id: user.id, role: user.role }, src, 'accepted', 'provider') : null,
        attended,
        sessionsMarked: mine.length,
        rate: mine.length ? round3(attended / mine.length) : null,
      };
    });
  }

  return {
    allocationId: allocationId.toString(),
    offeringTitle: offering?.title ?? 'Course',
    acceptedLearners: accepted.length,
    sessionsHeld: schedules.filter((s) => s.status === 'Held').length,
    attendanceRate: records.length ? round3(totalPresent / records.length) : null,
    sessions,
    learners,
  };
}
