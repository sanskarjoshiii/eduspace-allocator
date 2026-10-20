import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

import { Types } from 'mongoose';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import {
  Allocation, AttendanceRecord, AuditLog, Course, CourseOffering, Enrollment, LearningRequest, Notification, Schedule, Space,
} from '@/server/models';
import { GET as attGET, POST as attPOST } from '@/app/api/attendance/route';
import { GET as fbGET, POST as fbPOST } from '@/app/api/feedback/route';
import type { SessionUser } from '@/server/auth/session';
import type { AttendanceReport } from '@/server/services/attendance';
import type { FeedbackList } from '@/server/services/feedback';

type Doc = { _id: Types.ObjectId };
let admin: SessionUser;
let provider: SessionUser;
let otherProvider: SessionUser;
let spaceGiver: SessionUser;
let otherSpaceGiver: SessionUser;
let alice: SessionUser;
let bob: SessionUser;
let carol: SessionUser; // offered, not accepted
let offering: Doc;
let allocation: Doc;
let s1: Doc;
let s2: Doc;
const enr: Record<string, Doc> = {};
const EXACT: [number, number] = [73.814321, 18.512345];

beforeAll(async () => {
  admin = await makeUser('Administrator');
  provider = await makeUser('CourseProvider');
  otherProvider = await makeUser('CourseProvider');
  spaceGiver = await makeUser('SpaceGiver');
  otherSpaceGiver = await makeUser('SpaceGiver');
  alice = await makeUser('Learner', { name: 'Alice' });
  bob = await makeUser('Learner', { name: 'Bob' });
  carol = await makeUser('Learner', { name: 'Carol' });
  const area = await makeArea({ name: 'Kothrud' });
  const cat = await makeCategory('Python');
  const course = await Course.create({ providerUserId: provider.id, title: 'Python', categoryId: cat._id });
  offering = await CourseOffering.create({
    courseId: course._id, providerUserId: provider.id, title: 'Python Basics', categoryId: cat._id, batchSize: 10,
    sessionMinutes: 120, durationWeeks: 2, startDate: new Date(), status: 'Active',
  });
  const space = await Space.create({
    ownerUserId: spaceGiver.id, name: 'Sunrise Plaza', location: { type: 'Point', coordinates: [73.81, 18.5] }, areaId: area._id, seatCapacity: 30,
    slots: [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }],
  });
  allocation = await Allocation.create({
    offeringId: offering._id, spaceId: space._id, providerUserId: provider.id, spaceOwnerUserId: spaceGiver.id,
    session: { dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, score: 0.8, strategy: 'balanced', status: 'Active',
  });
  for (const [u, status] of [[alice, 'Accepted'], [bob, 'Accepted'], [carol, 'Offered']] as const) {
    const r = await LearningRequest.create({
      learnerUserId: u.id, learnerProfileId: u.ownerRefId, categoryId: cat._id, areaId: area._id, location: { type: 'Point', coordinates: EXACT },
      audience: 'Adults', maxDistanceKm: 5, startMonth: '2026-11', durationMonths: 3, consentShared: true, consentAt: new Date(), status,
    });
    enr[u.name] = await Enrollment.create({ requestId: r._id, learnerUserId: u.id, offeringId: offering._id, allocationId: allocation._id, status });
  }
  const sch = { allocationId: allocation._id, spaceId: space._id, offeringId: offering._id, startTime: '18:00', endTime: '20:00' };
  s1 = await Schedule.create({ ...sch, date: new Date('2026-10-05T00:00:00+05:30') });
  s2 = await Schedule.create({ ...sch, date: new Date('2026-10-12T00:00:00+05:30') });
});

describe('POST /api/attendance', () => {
  it('lets only the owning provider (or an administrator) mark attendance', async () => {
    const body = { scheduleId: s1._id.toString(), records: [{ enrollmentId: enr.Alice!._id.toString(), present: true }] };
    for (const u of [otherProvider, spaceGiver, alice]) {
      actAs(u);
      expect((await attPOST(req('POST', '/api/attendance', body), ctx())).status).toBe(403);
    }
  });

  it('rejects learners who did not accept a seat', async () => {
    actAs(provider);
    const res = await attPOST(
      req('POST', '/api/attendance', { scheduleId: s1._id.toString(), records: [{ enrollmentId: enr.Carol!._id.toString(), present: true }] }),
      ctx(),
    );
    expect(res.status).toBe(400);
    expect(await AttendanceRecord.countDocuments({})).toBe(0);
  });

  it('records attendance, upserts on re-marking, marks the session Held and audits', async () => {
    actAs(provider);
    const body = {
      scheduleId: s1._id.toString(),
      records: [{ enrollmentId: enr.Alice!._id.toString(), present: true }, { enrollmentId: enr.Bob!._id.toString(), present: true }],
    };
    expect((await attPOST(req('POST', '/api/attendance', body), ctx())).status).toBe(201);
    body.records[1]!.present = false;
    const again = await json<{ recorded: number; present: number }>(await attPOST(req('POST', '/api/attendance', body), ctx()));
    expect(again.data).toMatchObject({ recorded: 2, present: 1 });
    expect(await AttendanceRecord.countDocuments({})).toBe(2);
    expect((await Schedule.findById(s1._id).lean())!.status).toBe('Held');
    expect(await AuditLog.countDocuments({ entity: 'Attendance' })).toBe(2);
    expect(await Notification.countDocuments({ type: 'course.completed' })).toBe(0);
  });

  it('asks learners to rate once the last session is held', async () => {
    actAs(admin);
    const body = { scheduleId: s2._id.toString(), records: [{ enrollmentId: enr.Alice!._id.toString(), present: true }, { enrollmentId: enr.Bob!._id.toString(), present: true }] };
    expect((await attPOST(req('POST', '/api/attendance', body), ctx())).status).toBe(201);
    expect(await Notification.countDocuments({ type: 'course.completed' })).toBe(2);
    await attPOST(req('POST', '/api/attendance', body), ctx());
    expect(await Notification.countDocuments({ type: 'course.completed' })).toBe(2);
  });

  it('validates the body', async () => {
    actAs(provider);
    expect((await attPOST(req('POST', '/api/attendance', { scheduleId: 'x', records: [] }), ctx())).status).toBe(422);
  });
});

describe('GET /api/attendance', () => {
  it('gives the provider per-learner rates with accepted-stage details and area centre only', async () => {
    actAs(provider);
    const res = await json<AttendanceReport>(await attGET(req('GET', `/api/attendance?allocationId=${allocation._id}`), ctx()));
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ acceptedLearners: 2, sessionsHeld: 2, attendanceRate: 0.75 });
    expect(res.data.sessions.map((s) => [s.present, s.absent])).toEqual([[1, 1], [2, 0]]);
    const alice = res.data.learners!.find((l) => l.learner && 'name' in l.learner && l.learner.name === 'Alice')!;
    expect(alice.rate).toBe(1);
    expect(alice.learner!.visibility).toBe('provider-accepted');
    const body = JSON.stringify(res.data);
    expect(body).not.toContain(String(EXACT[0]));
    expect(body).not.toContain('Carol');
  });

  it('gives the Space Giver counts only', async () => {
    actAs(spaceGiver);
    const res = await json<AttendanceReport>(await attGET(req('GET', `/api/attendance?allocationId=${allocation._id}`), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.learners).toBeNull();
    expect(JSON.stringify(res.data)).not.toContain('Alice');
  });

  it('blocks other owners and learners', async () => {
    for (const u of [otherProvider, otherSpaceGiver, alice]) {
      actAs(u);
      expect((await attGET(req('GET', `/api/attendance?allocationId=${allocation._id}`), ctx())).status).toBe(403);
    }
  });
});

describe('feedback', () => {
  it('only enrolled learners with an accepted seat can rate, once', async () => {
    actAs(carol);
    expect((await fbPOST(req('POST', '/api/feedback', { enrollmentId: enr.Carol!._id.toString(), rating: 5 }), ctx())).status).toBe(403);
    actAs(bob);
    expect((await fbPOST(req('POST', '/api/feedback', { enrollmentId: enr.Alice!._id.toString(), rating: 5 }), ctx())).status).toBe(403);
    actAs(alice);
    expect((await fbPOST(req('POST', '/api/feedback', { enrollmentId: enr.Alice!._id.toString(), rating: 6 }), ctx())).status).toBe(422);
    expect((await fbPOST(req('POST', '/api/feedback', { enrollmentId: enr.Alice!._id.toString(), rating: 4, comment: 'x'.repeat(2001) }), ctx())).status).toBe(422);
    expect((await fbPOST(req('POST', '/api/feedback', { enrollmentId: enr.Alice!._id.toString(), rating: 4, comment: 'Good' }), ctx())).status).toBe(201);
    expect((await fbPOST(req('POST', '/api/feedback', { enrollmentId: enr.Alice!._id.toString(), rating: 5 }), ctx())).status).toBe(409);
    actAs(bob);
    expect((await fbPOST(req('POST', '/api/feedback', { enrollmentId: enr.Bob!._id.toString(), rating: 5 }), ctx())).status).toBe(201);
    for (const u of [provider, spaceGiver, admin]) {
      actAs(u);
      expect((await fbPOST(req('POST', '/api/feedback', { enrollmentId: enr.Bob!._id.toString(), rating: 5 }), ctx())).status).toBe(403);
    }
  });

  it('shows the provider their offering feedback with the average, anonymously', async () => {
    actAs(provider);
    const res = await json<FeedbackList>(await fbGET(req('GET', `/api/feedback?offeringId=${offering._id}`), ctx()));
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ count: 2, averageRating: 4.5 });
    expect(res.data.items.every((i) => i.learnerName === null)).toBe(true);
    const all = await json<FeedbackList>(await fbGET(req('GET', '/api/feedback'), ctx()));
    expect(all.data.count).toBe(2);
  });

  it('shows a learner only their own feedback and the admin everything', async () => {
    actAs(alice);
    const mine = await json<FeedbackList>(await fbGET(req('GET', `/api/feedback?offeringId=${offering._id}`), ctx()));
    expect(mine.data.count).toBe(1);
    expect(mine.data.items[0]!.learnerName).toBe('Alice');
    actAs(admin);
    expect((await json<FeedbackList>(await fbGET(req('GET', '/api/feedback'), ctx()))).data.count).toBe(2);
  });

  it('blocks other providers and Space Givers', async () => {
    actAs(otherProvider);
    expect((await fbGET(req('GET', `/api/feedback?offeringId=${offering._id}`), ctx())).status).toBe(403);
    const own = await json<FeedbackList>(await fbGET(req('GET', '/api/feedback'), ctx()));
    expect(own.data.count).toBe(0);
    actAs(spaceGiver);
    expect((await fbGET(req('GET', '/api/feedback'), ctx())).status).toBe(403);
  });
});
