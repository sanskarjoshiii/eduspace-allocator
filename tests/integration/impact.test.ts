import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

import { Types } from 'mongoose';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import {
  Allocation, AllocationRun, Area, AttendanceRecord, Course, CourseOffering, Enrollment, LearningRequest, Partner, Schedule, SocialImpact, Space,
} from '@/server/models';
import { computeImpactSnapshot, currentPeriod, periodBounds } from '@/server/services/impact';
import { GET as impactGET } from '@/app/api/impact/route';
import { GET as sdgGET } from '@/app/api/sdg/route';
import { GET as publicGET } from '@/app/api/public/impact/route';
import type { SessionUser } from '@/server/auth/session';
import type { ImpactResponse, PublicImpactDto, SdgResponse } from '@/server/dto/impact';

const PERIOD = '2026-10';
const EXACT: [number, number] = [73.819876, 18.511234];
let users: Record<string, SessionUser> = {};

beforeAll(async () => {
  users = {
    admin: await makeUser('Administrator'),
    sg: await makeUser('SpaceGiver'),
    sgIdle: await makeUser('SpaceGiver'),
    provider: await makeUser('CourseProvider'),
    provider2: await makeUser('CourseProvider'),
    a: await makeUser('Learner', { name: 'Asha' }),
    b: await makeUser('Learner'),
    c: await makeUser('Learner'),
  };
  await Partner.create({ userId: new Types.ObjectId(), type: 'IndividualTutor', name: 'Solo Tutor' });
  const high = await makeArea({ name: 'Kothrud' });
  const low = await makeArea({ name: 'Aundh', lat: 18.559 });
  await Area.updateOne({ _id: high._id }, { $set: { demandLevel: 'High' } });
  const cat = await makeCategory('Python');

  const space = await Space.create({
    ownerUserId: users.sg!.id, name: 'Sunrise Plaza', location: { type: 'Point', coordinates: [73.81, 18.5] }, areaId: high._id, seatCapacity: 30,
    slots: [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, { dayOfWeek: 3, startTime: '18:00', endTime: '20:00' }],
  });
  await Space.create({
    ownerUserId: users.sgIdle!.id, name: 'Idle Hall', location: { type: 'Point', coordinates: [73.82, 18.51] }, areaId: low._id, seatCapacity: 30,
    slots: [{ dayOfWeek: 2, startTime: '10:00', endTime: '14:00' }],
  });
  const course = await Course.create({ providerUserId: users.provider!.id, title: 'Python', categoryId: cat._id });
  const base = { courseId: course._id, providerUserId: users.provider!.id, categoryId: cat._id, sessionMinutes: 120, durationWeeks: 4, startDate: new Date() };
  const offering = await CourseOffering.create({ ...base, title: 'Python Basics', batchSize: 10, status: 'Active' });
  const proposedOff = await CourseOffering.create({ ...base, providerUserId: users.provider2!.id, title: 'Draft-ish', batchSize: 10, status: 'Open' });
  const alloc = await Allocation.create({
    offeringId: offering._id, spaceId: space._id, providerUserId: users.provider!.id, spaceOwnerUserId: users.sg!.id,
    session: { dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, score: 0.8, strategy: 'balanced', status: 'Active',
  });
  // A proposal does not serve learners, give a venue or book hours.
  const proposal = await Allocation.create({
    offeringId: proposedOff._id, spaceId: space._id, providerUserId: users.provider2!.id, spaceOwnerUserId: users.sg!.id,
    session: { dayOfWeek: 3, startTime: '18:00', endTime: '20:00' }, score: 0.5, strategy: 'balanced', status: 'Proposed',
  });

  const enroll = async (u: SessionUser, areaId: Types.ObjectId, status: string, allocationId: Types.ObjectId, offeringId: Types.ObjectId, distanceKm: number) => {
    const r = await LearningRequest.create({
      learnerUserId: u.id, learnerProfileId: u.ownerRefId, categoryId: cat._id, areaId, location: { type: 'Point', coordinates: EXACT }, audience: 'Adults',
      maxDistanceKm: 10, startMonth: '2026-10', durationMonths: 2, consentShared: true, consentAt: new Date(),
      status: status === 'Proposed' ? 'Matched' : status,
    });
    return Enrollment.create({ requestId: r._id, learnerUserId: u.id, offeringId, allocationId, status, distanceKm });
  };
  const ea = await enroll(users.a!, high._id, 'Accepted', alloc._id, offering._id, 2);
  const eb = await enroll(users.b!, low._id, 'Accepted', alloc._id, offering._id, 4);
  await enroll(users.c!, low._id, 'Proposed', proposal._id, proposedOff._id, 1);

  const sch = { allocationId: alloc._id, spaceId: space._id, offeringId: offering._id, startTime: '18:00', endTime: '20:00' };
  const held = await Schedule.create({ ...sch, date: new Date('2026-10-05T00:00:00+05:30'), status: 'Held' });
  await Schedule.create({ ...sch, date: new Date('2026-10-12T00:00:00+05:30') }); // planned, no attendance
  await Schedule.create({ ...sch, date: new Date('2026-10-19T00:00:00+05:30'), status: 'Cancelled' });
  await Schedule.create({ ...sch, date: new Date('2026-11-02T00:00:00+05:30') }); // next period
  await AttendanceRecord.create({ enrollmentId: ea._id, scheduleId: held._id, allocationId: alloc._id, sessionDate: held.date, present: true, markedBy: users.provider!.id });
  await AttendanceRecord.create({ enrollmentId: eb._id, scheduleId: held._id, allocationId: alloc._id, sessionDate: held.date, present: false, markedBy: users.provider!.id });
  await AllocationRun.create({
    trigger: 'manual', status: 'Completed', strategy: 'balanced', finishedAt: new Date(), metrics: { avgDistanceKm: 2.5 }, baselineMetrics: { avgDistanceKm: 4 },
  });
});

describe('impact snapshot', () => {
  it('uses Asia/Kolkata month boundaries', () => {
    expect(currentPeriod(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11'); // 00:30 IST on 1 Nov
    expect(periodBounds('2026-12')).toEqual({ start: new Date('2026-11-30T18:30:00Z'), end: new Date('2026-12-31T18:30:00Z') });
  });

  it('reconciles with the underlying records', async () => {
    await computeImpactSnapshot(PERIOD);
    const snap = await SocialImpact.findOne({ period: PERIOD }).lean();
    expect(snap!.metrics).toMatchObject({
      learnersServed: 2, // a and b accepted in an Active allocation; c only proposed
      learningHours: 6, // held: 2h x 1 present; planned: 2h x 2 accepted; cancelled and November excluded
      providersWithVenue: 1,
      sessionsScheduled: 2,
      spacesUsed: 1,
      idleHoursUsed: 2, // only the Active allocation holds a slot
      areasReached: 2,
      highDemandAreasServed: 1,
      avgDistanceKm: 3, // (2 + 4) / 2 accepted
      spaceUtilisation: 0.25, // 2 booked / (4 + 4) open weekly hours
      activeSpaceGivers: 2,
      activeProviders: 2,
      ngoPartners: 4, // 2 SpaceGiverOrg + 2 ProviderOrg from the factory; the individual tutor is excluded
    });
  });

  it('upserts by period instead of duplicating', async () => {
    await computeImpactSnapshot(PERIOD);
    expect(await SocialImpact.countDocuments({ period: PERIOD })).toBe(1);
    await expect(computeImpactSnapshot('2026-13')).rejects.toThrow();
  });
});

describe('impact endpoints', () => {
  it('GET /api/impact works for every signed-in role', async () => {
    await computeImpactSnapshot('2026-09');
    for (const u of [users.admin!, users.a!, users.sg!, users.provider!]) {
      actAs(u);
      const res = await json<ImpactResponse>(await impactGET(req('GET', '/api/impact'), ctx()));
      expect(res.status).toBe(200);
      expect(res.data.latest.period).toBe(PERIOD);
      expect(res.data.history.map((h) => h.period)).toEqual(['2026-09', PERIOD]);
    }
    actAs(null);
    expect((await impactGET(req('GET', '/api/impact'), ctx())).status).toBe(401);
  });

  it('GET /api/sdg lists the six goals with indicators', async () => {
    actAs(users.a!);
    const res = await json<SdgResponse>(await sdgGET(req('GET', '/api/sdg'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.goals.map((g) => g.goal)).toEqual([4, 8, 9, 10, 11, 17]);
    const value = (goal: number, key: string) => res.data.goals.find((g) => g.goal === goal)!.indicators.find((i) => i.key === key)!.value;
    expect(value(4, 'learnersServed')).toBe(2);
    expect(value(4, 'learningHours')).toBe(6);
    expect(value(11, 'distanceReducedKm')).toBe(1.5);
    expect(value(17, 'individualTutors')).toBe(1);
    actAs(null);
    expect((await sdgGET(req('GET', '/api/sdg'), ctx())).status).toBe(401);
  });

  it('GET /api/public/impact needs no sign-in and carries no personal data', async () => {
    actAs(null);
    const res = await json<PublicImpactDto>(await publicGET(req('GET', '/api/public/impact'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ period: PERIOD, learnersServed: 2, learningHours: 6 });
    const body = JSON.stringify(res.data);
    expect(body).not.toContain('Asha');
    expect(body).not.toContain(String(EXACT[0]));
    expect(body).not.toMatch(/[a-f\d]{24}/);
  });
});
