import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
vi.mock('@/server/services/alerts', () => ({ evaluateDemandAlerts: vi.fn(async () => ({ fired: 0 })) }));
vi.mock('@/server/services/impact', () => ({ computeImpactSnapshot: vi.fn(async () => undefined) }));
vi.mock('@/server/services/engine-client', async () => {
  const { referenceEngine } = await import('@/server/worker/reference-engine');
  return { getEngine: () => referenceEngine };
});

import mongoose, { Types } from 'mongoose';
import { connectDb } from '@/lib/db';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import { Allocation, Course, CourseOffering, Enrollment, LearningRequest, Notification, Schedule, Space } from '@/server/models';
import { POST as acceptPOST } from '@/app/api/enrollments/[id]/accept/route';
import { GET as schedulesGET } from '@/app/api/schedules/route';
import { firstWeekday } from '@/server/services/scheduling';
import { istToday } from '@/server/worker/lifecycle';
import { progressLifecycles } from '@/server/worker/nightly';
import type { SessionUser } from '@/server/auth/session';
import type { ScheduleDto } from '@/server/dto/schedule';

beforeEach(async () => {
  await connectDb();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

const DAY = 86_400_000;

async function seed(learnerCount = 2) {
  const admin = await makeUser('Administrator');
  const provider = await makeUser('CourseProvider');
  const giver = await makeUser('SpaceGiver');
  const area = await makeArea();
  const category = await makeCategory();
  const space = await Space.create({
    ownerUserId: giver.id, name: 'Sunrise Hall', location: { type: 'Point', coordinates: [73.81, 18.51] }, areaId: area._id, seatCapacity: 30,
    slots: [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }],
  });
  const course = await Course.create({ providerUserId: provider.id, title: 'Python Basics', categoryId: category._id });
  const startDate = new Date(Date.now() + 10 * DAY);
  const offering = await CourseOffering.create({
    courseId: course._id, providerUserId: provider.id, title: 'Python Basics', categoryId: category._id, batchSize: 5,
    sessionMinutes: 120, durationWeeks: 4, startDate, status: 'Allocated',
  });
  const alloc = await Allocation.create({
    offeringId: offering._id, spaceId: space._id, providerUserId: provider.id, spaceOwnerUserId: giver.id,
    session: { dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }, score: 0.8, strategy: 'balanced', status: 'ConfirmedByProvider',
  });
  const learners: { user: SessionUser; requestId: Types.ObjectId; enrollmentId: Types.ObjectId }[] = [];
  for (let i = 0; i < learnerCount; i++) {
    const user = await makeUser('Learner');
    const r = await LearningRequest.create({
      learnerUserId: user.id, learnerProfileId: user.ownerRefId, categoryId: category._id, areaId: area._id,
      location: { type: 'Point', coordinates: [73.808, 18.508] }, audience: 'Adults', maxDistanceKm: 5, startMonth: '2026-11',
      durationMonths: 2, consentShared: true, consentAt: new Date(), status: 'Offered',
    });
    const e = await Enrollment.create({
      requestId: r._id, learnerUserId: user.id, offeringId: offering._id, allocationId: alloc._id, status: 'Offered',
      offerExpiresAt: new Date(Date.now() + 2 * DAY),
    });
    learners.push({ user, requestId: r._id, enrollmentId: e._id });
  }
  return { admin, provider, giver, area, category, space, course, offering, alloc, learners, startDate };
}

async function accept(l: { user: SessionUser; enrollmentId: Types.ObjectId }) {
  actAs(l.user);
  const res = await acceptPOST(req('POST', '/x'), ctx({ id: l.enrollmentId.toString() }));
  expect(res.status).toBe(200);
}

describe('schedule generation', () => {
  it('the first acceptance generates weekly sessions on the session weekday, IST dates stored as UTC midnight', async () => {
    const w = await seed();
    await accept(w.learners[0]!);
    const sessions = await Schedule.find({ allocationId: w.alloc._id }).sort({ date: 1 }).lean();
    expect(sessions).toHaveLength(4);
    for (const s of sessions) {
      expect(s.status).toBe('Planned');
      expect(s.date.getUTCDay()).toBe(6);
      expect(s.date.getUTCHours()).toBe(0);
      expect(s.startTime).toBe('10:00');
      expect(s.date.getTime()).toBeGreaterThanOrEqual(istToday().getTime());
    }
    expect(sessions[0]!.date.getTime()).toBeGreaterThanOrEqual(istToday(w.startDate).getTime());
    expect(sessions[1]!.date.getTime() - sessions[0]!.date.getTime()).toBe(7 * DAY);

    expect((await Allocation.findById(w.alloc._id).lean())?.status).toBe('Scheduled');
    expect((await LearningRequest.findById(w.learners[0]!.requestId).lean())?.status).toBe('Scheduled');
    for (const u of [w.learners[0]!.user, w.provider, w.giver]) {
      expect(await Notification.countDocuments({ type: 'schedule.created', userId: u.id })).toBe(1);
    }
  });

  it('later acceptances do not regenerate the schedule', async () => {
    const w = await seed();
    await accept(w.learners[0]!);
    await accept(w.learners[1]!);
    expect(await Schedule.countDocuments({ allocationId: w.alloc._id })).toBe(4);
    expect((await LearningRequest.findById(w.learners[1]!.requestId).lean())?.status).toBe('Scheduled');
    expect(await Notification.countDocuments({ type: 'schedule.created', userId: w.learners[1]!.user.id })).toBe(1);
  });

  it('a clash on the same space is not double-booked; it is flagged to admins and the provider', async () => {
    const w = await seed(1);
    const otherOffering = await CourseOffering.create({
      courseId: w.course._id, providerUserId: w.provider.id, title: 'Spoken English', categoryId: w.category._id, batchSize: 5,
      sessionMinutes: 120, durationWeeks: 4, startDate: w.startDate, status: 'Allocated',
    });
    const other = await Allocation.create({
      offeringId: otherOffering._id, spaceId: w.space._id, providerUserId: w.provider.id, spaceOwnerUserId: w.giver.id,
      session: { dayOfWeek: 6, startTime: '11:00', endTime: '13:00' }, score: 0.8, strategy: 'balanced', status: 'Scheduled',
    });
    const first = firstWeekday(istToday(w.startDate), 6);
    await Schedule.create({ allocationId: other._id, spaceId: w.space._id, offeringId: otherOffering._id, date: first, startTime: '11:00', endTime: '13:00' });

    await accept(w.learners[0]!);
    const mine = await Schedule.find({ allocationId: w.alloc._id }).sort({ date: 1 }).lean();
    expect(mine[0]!.status).toBe('Moved');
    expect(mine[0]!.note).toBe('Clash with Spoken English');
    expect(mine.slice(1).every((s) => s.status === 'Planned')).toBe(true);
    expect(await Notification.countDocuments({ type: 'schedule.clash', userId: w.admin.id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'schedule.clash', userId: w.provider.id })).toBe(1);

    // No two occupying sessions overlap on one space and date.
    const occupying = await Schedule.find({ spaceId: w.space._id, status: { $in: ['Planned', 'Held'] } }).lean();
    for (const a of occupying) {
      for (const b of occupying) {
        if (a._id.equals(b._id) || a.date.getTime() !== b.date.getTime()) continue;
        expect(a.startTime < b.endTime && b.startTime < a.endTime).toBe(false);
      }
    }
  });

  it('firstWeekday finds the next matching weekday', () => {
    const wed = new Date(Date.UTC(2026, 9, 14)); // Wednesday
    expect(firstWeekday(wed, 3).toISOString().slice(0, 10)).toBe('2026-10-14');
    expect(firstWeekday(wed, 6).toISOString().slice(0, 10)).toBe('2026-10-17');
    expect(firstWeekday(wed, 0).toISOString().slice(0, 10)).toBe('2026-10-18');
  });
});

describe('GET /api/schedules', () => {
  it('is scoped per role', async () => {
    const w = await seed();
    await accept(w.learners[0]!);

    actAs(w.learners[0]!.user);
    const mine = await json<ScheduleDto[]>(await schedulesGET(req('GET', '/api/schedules?mine=1'), ctx()));
    expect(mine.data).toHaveLength(4);
    expect(mine.data[0]).toMatchObject({ courseTitle: 'Python Basics', spaceName: 'Sunrise Hall', status: 'Planned' });

    actAs(w.learners[1]!.user); // offered, not accepted
    expect((await json<ScheduleDto[]>(await schedulesGET(req('GET', '/api/schedules?mine=1'), ctx()))).data).toHaveLength(0);
    expect((await schedulesGET(req('GET', `/api/schedules?allocationId=${w.alloc._id.toString()}`), ctx())).status).toBe(403);

    actAs(w.giver);
    expect((await json<ScheduleDto[]>(await schedulesGET(req('GET', '/api/schedules'), ctx()))).data).toHaveLength(4);
    actAs(w.provider);
    expect((await json<ScheduleDto[]>(await schedulesGET(req('GET', `/api/schedules?allocationId=${w.alloc._id.toString()}`), ctx()))).data).toHaveLength(4);
    const stranger = await makeUser('SpaceGiver');
    actAs(stranger);
    expect((await json<ScheduleDto[]>(await schedulesGET(req('GET', '/api/schedules'), ctx()))).data).toHaveLength(0);
  });
});

describe('lifecycle progression', () => {
  it('Scheduled → Active → Completed as session dates pass, and learners are asked to rate', async () => {
    const w = await seed(1);
    await accept(w.learners[0]!);
    const res = await progressLifecycles(new Date(Date.now() + 120 * DAY));
    expect(res.activated).toContain(w.alloc._id.toString());
    expect(res.completed).toContain(w.alloc._id.toString());
    expect((await Allocation.findById(w.alloc._id).lean())?.status).toBe('Completed');
    expect((await CourseOffering.findById(w.offering._id).lean())?.status).toBe('Completed');
    expect((await LearningRequest.findById(w.learners[0]!.requestId).lean())?.status).toBe('Completed');
    expect(await Notification.countDocuments({ type: 'course.completed', userId: w.learners[0]!.user.id })).toBe(1);
  });

  it('does nothing before the first session', async () => {
    const w = await seed(1);
    await accept(w.learners[0]!);
    const res = await progressLifecycles(new Date());
    expect(res.activated).toHaveLength(0);
    expect((await Allocation.findById(w.alloc._id).lean())?.status).toBe('Scheduled');
  });
});
