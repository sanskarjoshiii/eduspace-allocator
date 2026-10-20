import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
vi.mock('@/server/worker/snapshot', () => ({ buildSnapshot: vi.fn() }));
vi.mock('@/server/services/engine-client', () => ({ getEngine: () => ({ suggestFor: () => [] }) }));

import { Types } from 'mongoose';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeFacilityType, makeUser } from '../helpers/factories';
import {
  Allocation, AllocationRun, AttendanceRecord, Course, CourseOffering, DemandInsight, Enrollment, FacilityIssue, Feedback, LearningRequest, Schedule, Space,
} from '@/server/models';
import { GET as analyticsGET } from '@/app/api/analytics/route';
import { GET as dashboardGET } from '@/app/api/analytics/dashboard/route';
import type { SessionUser } from '@/server/auth/session';
import type {
  AdminAnalytics, AdminDashboard, LearnerDashboard, ProviderAnalytics, ProviderDashboard, SpaceGiverAnalytics, SpaceGiverDashboard,
} from '@/server/dto/analytics';

type Doc = { _id: Types.ObjectId };
let admin: SessionUser;
let learner: SessionUser;
let waitLearner: SessionUser;
let sg: SessionUser;
let otherSg: SessionUser;
let provider: SessionUser;
let otherProvider: SessionUser;
let python: Doc;
let mySpace: Doc;
let otherSpace: Doc;
let offering: Doc;
const EXACT: [number, number] = [73.816543, 18.507654];

const reqDoc = (u: SessionUser, categoryId: Types.ObjectId, areaId: Types.ObjectId, status: string) => ({
  learnerUserId: u.id, learnerProfileId: u.ownerRefId, categoryId, areaId, location: { type: 'Point', coordinates: EXACT }, audience: 'Adults',
  maxDistanceKm: 10, startMonth: '2026-11', durationMonths: 3, consentShared: true, consentAt: new Date(), status,
});

beforeAll(async () => {
  admin = await makeUser('Administrator');
  sg = await makeUser('SpaceGiver');
  otherSg = await makeUser('SpaceGiver');
  provider = await makeUser('CourseProvider');
  otherProvider = await makeUser('CourseProvider');
  const kothrud = await makeArea({ name: 'Kothrud', lng: 73.8077, lat: 18.5074 });
  learner = await makeUser('Learner', { areaId: kothrud._id.toString() });
  waitLearner = await makeUser('Learner');
  const unmatchedLearner = await makeUser('Learner', { name: 'Uma' });
  python = await makeCategory('Python');
  const ft = await makeFacilityType('Computers');

  mySpace = await Space.create({
    ownerUserId: sg.id, name: 'Sunrise Plaza', location: { type: 'Point', coordinates: [73.81, 18.505] }, areaId: kothrud._id, seatCapacity: 30,
    slots: [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, { dayOfWeek: 3, startTime: '18:00', endTime: '21:00' }],
  });
  otherSpace = await Space.create({
    ownerUserId: otherSg.id, name: 'Other Hall', location: { type: 'Point', coordinates: [73.82, 18.51] }, areaId: kothrud._id, seatCapacity: 20,
    slots: [{ dayOfWeek: 2, startTime: '10:00', endTime: '14:00' }],
  });
  const course = await Course.create({ providerUserId: provider.id, title: 'Python', categoryId: python._id });
  const base = { courseId: course._id, providerUserId: provider.id, categoryId: python._id, sessionMinutes: 120, durationWeeks: 8, startDate: new Date() };
  offering = await CourseOffering.create({ ...base, title: 'Python Basics', batchSize: 10, status: 'Active' });
  await CourseOffering.create({ ...base, title: 'Python Draft', batchSize: 5, status: 'Draft' });
  const oc = await Course.create({ providerUserId: otherProvider.id, title: 'Art', categoryId: (await makeCategory('Art'))._id });
  const otherOffering = await CourseOffering.create({ ...base, courseId: oc._id, providerUserId: otherProvider.id, title: 'Art Class', batchSize: 8, status: 'Open' });

  const alloc = await Allocation.create({
    offeringId: offering._id, spaceId: mySpace._id, providerUserId: provider.id, spaceOwnerUserId: sg.id,
    session: { dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, score: 0.8, strategy: 'balanced', status: 'Scheduled',
  });
  await Allocation.create({
    offeringId: otherOffering._id, spaceId: mySpace._id, providerUserId: otherProvider.id, spaceOwnerUserId: sg.id,
    session: { dayOfWeek: 3, startTime: '18:00', endTime: '20:00' }, score: 0.6, strategy: 'balanced', status: 'Proposed',
  });

  const r1 = await LearningRequest.create(reqDoc(learner, python._id, kothrud._id, 'Accepted'));
  const e1 = await Enrollment.create({ requestId: r1._id, learnerUserId: learner.id, offeringId: offering._id, allocationId: alloc._id, status: 'Accepted', distanceKm: 2 });
  const r2 = await LearningRequest.create(reqDoc(waitLearner, python._id, kothrud._id, 'Offered'));
  await Enrollment.create({
    requestId: r2._id, learnerUserId: waitLearner.id, offeringId: offering._id, allocationId: alloc._id, status: 'Offered', distanceKm: 4,
    offerExpiresAt: new Date(Date.now() + 86_400_000),
  });
  await LearningRequest.create({ ...reqDoc(unmatchedLearner, python._id, kothrud._id, 'Unmatched'), suggestions: [{ categoryId: python._id, score: 0.5, reasons: ['Try Saturday'] }] });
  await LearningRequest.create(reqDoc(unmatchedLearner, python._id, kothrud._id, 'Cancelled'));

  const future = new Date(Date.now() + 3 * 86_400_000);
  const past = await Schedule.create({ allocationId: alloc._id, spaceId: mySpace._id, offeringId: offering._id, date: new Date('2026-09-07T00:00:00+05:30'), startTime: '18:00', endTime: '20:00', status: 'Held' });
  await Schedule.create({ allocationId: alloc._id, spaceId: mySpace._id, offeringId: offering._id, date: future, startTime: '18:00', endTime: '20:00' });
  await AttendanceRecord.create({ enrollmentId: e1._id, scheduleId: past._id, allocationId: alloc._id, sessionDate: past.date, present: true, markedBy: provider.id });
  await Feedback.create({ enrollmentId: e1._id, learnerUserId: learner.id, offeringId: offering._id, rating: 4 });
  await FacilityIssue.create({ spaceId: mySpace._id, reportedBy: sg.id, facilityTypeId: ft._id, affectedQuantity: 3 });
  await FacilityIssue.create({ spaceId: otherSpace._id, reportedBy: otherSg.id, facilityTypeId: ft._id, affectedQuantity: 1, status: 'Resolved' });
  await DemandInsight.create({ areaId: kothrud._id, categoryId: python._id, level: 'High', demand: 30, seatsOffered: 10, gap: 20 });
  await AllocationRun.create({ trigger: 'manual', status: 'Completed', strategy: 'balanced', metrics: { coverageRate: 0.5 }, finishedAt: new Date() });
});

describe('GET /api/analytics', () => {
  it('gives the Administrator global KPIs', async () => {
    actAs(admin);
    const res = await json<AdminAnalytics>(await analyticsGET(req('GET', '/api/analytics'), ctx()));
    expect(res.status).toBe(200);
    const k = res.data.kpis;
    expect(k.requestsTotal).toBe(4);
    expect(k.requestsByStatus).toMatchObject({ Accepted: 1, Offered: 1, Unmatched: 1, Cancelled: 1 });
    expect(k.coverageRate).toBeCloseTo(2 / 3, 3);
    expect(k.avgDistanceKm).toBe(3);
    expect(k.seatUtilisation).toBeCloseTo(2 / 18, 3);
    expect(k.spaceUtilisationHours).toBe(2);
    expect(k.unmatchedCount).toBe(1);
    expect(k.facilityAlertsOpen).toBe(1);
    expect(k.runsLast30Days).toBe(1);
    expect(k.allocationsByStatus).toMatchObject({ Scheduled: 1, Proposed: 1 });
    expect(k.trend).toHaveLength(12);
    expect(k.trend.at(-1)!.requests).toBe(4);
  });

  it('lets an Administrator view one owner\'s scope', async () => {
    actAs(admin);
    const res = await json<SpaceGiverAnalytics>(await analyticsGET(req('GET', `/api/analytics?scope=SpaceGiver&ownerId=${sg.id}`), ctx()));
    expect(res.data.scope).toBe('SpaceGiver');
    expect(res.data.spaces).toHaveLength(1);
    expect((await analyticsGET(req('GET', `/api/analytics?scope=SpaceGiver&ownerId=${provider.id}`), ctx())).status).toBe(403);
  });

  it('gives a Space Giver only their own spaces', async () => {
    actAs(sg);
    const res = await json<SpaceGiverAnalytics>(await analyticsGET(req('GET', '/api/analytics?scope=global'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.scope).toBe('SpaceGiver');
    expect(res.data.spaces.map((s) => s.spaceName)).toEqual(['Sunrise Plaza']);
    expect(res.data.totals).toMatchObject({ openHours: 5, bookedHours: 2, unusedHours: 3 });
    expect(res.data.byWeekday[1]).toMatchObject({ openHours: 2, bookedHours: 2 });
    expect(res.data).toMatchObject({ upcomingSessions: 1, pendingApprovals: 1, sessionsHeld: 1, issuesOpen: 1 });
  });

  it('gives a Course Provider only their own courses', async () => {
    actAs(provider);
    const res = await json<ProviderAnalytics>(await analyticsGET(req('GET', '/api/analytics'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      scope: 'CourseProvider', offeringsByStatus: { Active: 1, Draft: 1 }, seatsOffered: 10, seatsFilled: 1, acceptedLearners: 1,
      attendanceRate: 1, averageRating: 4, ratingsCount: 1,
    });
    expect(res.data.highDemandAreas[0]).toMatchObject({ areaName: 'Kothrud', categoryName: 'Python', gap: 20 });
  });

  it('returns 403 for a cross-scope request and for learners', async () => {
    actAs(sg);
    expect((await analyticsGET(req('GET', `/api/analytics?ownerId=${otherSg.id}`), ctx())).status).toBe(403);
    actAs(provider);
    expect((await analyticsGET(req('GET', `/api/analytics?ownerId=${otherProvider.id}`), ctx())).status).toBe(403);
    expect((await analyticsGET(req('GET', `/api/analytics?ownerId=${provider.id}`), ctx())).status).toBe(200);
    actAs(learner);
    expect((await analyticsGET(req('GET', '/api/analytics'), ctx())).status).toBe(403);
    actAs(null);
    expect((await analyticsGET(req('GET', '/api/analytics'), ctx())).status).toBe(401);
  });
});

describe('GET /api/analytics/dashboard', () => {
  it('Administrator widgets', async () => {
    actAs(admin);
    const res = await json<AdminDashboard>(await dashboardGET(req('GET', '/api/analytics/dashboard'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.role).toBe('Administrator');
    expect(res.data.latestRun?.status).toBe('Completed');
    expect(res.data.unmatchedRequests).toEqual([expect.objectContaining({ learnerName: 'Uma', categoryName: 'Python', areaName: 'Kothrud', topSuggestion: 'Try Saturday' })]);
    expect(res.data.facilityAlerts).toHaveLength(1);
    expect(res.data.facilityAlerts[0]).toMatchObject({ spaceName: 'Sunrise Plaza', facilityName: 'Computers', affectedQuantity: 3 });
    expect(res.data.demandByArea[0]).toMatchObject({ areaName: 'Kothrud', gap: 20 });
    expect(res.data.utilisation).toMatchObject({ bookedHours: 2, openHours: 9 });
    expect(res.data.impact.metrics.learnersServed).toBe(1);
  });

  it('Learner widgets', async () => {
    actAs(waitLearner);
    const res = await json<LearnerDashboard>(await dashboardGET(req('GET', '/api/analytics/dashboard'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.role).toBe('Learner');
    expect(res.data.requests[0]!.status).toBe('Offered');
    expect(res.data.requests[0]!.timeline.find((s) => s.status === 'Offered')!.state).toBe('current');
    expect(res.data.requests[0]!.timeline.find((s) => s.status === 'Matched')!.state).toBe('done');
    expect(res.data.pendingOffers).toEqual([expect.objectContaining({ offeringTitle: 'Python Basics', spaceName: 'Sunrise Plaza', session: 'Mon 18:00–20:00', distanceKm: 4 })]);
    expect(Array.isArray(res.data.recommended)).toBe(true);
    expect(typeof res.data.nearbyOffers).toBe('number');
  });

  it('Space Giver widgets show only own data and aggregated demand', async () => {
    actAs(sg);
    const res = await json<SpaceGiverDashboard>(await dashboardGET(req('GET', '/api/analytics/dashboard'), ctx()));
    expect(res.data.role).toBe('SpaceGiver');
    expect(res.data.upcomingSessions).toEqual([expect.objectContaining({ spaceName: 'Sunrise Plaza', courseTitle: 'Python Basics' })]);
    expect(res.data.pendingApprovals).toEqual([expect.objectContaining({ courseTitle: 'Art Class', session: 'Wed 18:00–20:00', headcount: 0 })]);
    expect(res.data.unusedHours).toBe(3);
    expect(res.data.openIssues).toHaveLength(1);
    expect(res.data.nearbyDemand[0]).toMatchObject({ areaName: 'Kothrud', openRequests: 1 });
    const body = JSON.stringify(res.data);
    expect(body).not.toContain('Other Hall');
    expect(body).not.toContain(String(EXACT[0]));
  });

  it('Course Provider widgets', async () => {
    actAs(provider);
    const res = await json<ProviderDashboard>(await dashboardGET(req('GET', '/api/analytics/dashboard'), ctx()));
    expect(res.data.role).toBe('CourseProvider');
    const basics = res.data.offerings.find((o) => o.title === 'Python Basics')!;
    expect(basics.assigned).toMatchObject({ spaceName: 'Sunrise Plaza', areaName: 'Kothrud', session: 'Mon 18:00–20:00', allocationStatus: 'Scheduled' });
    expect(basics.acceptedLearners).toBe(1);
    expect(res.data.offerings.map((o) => o.title)).not.toContain('Art Class');
    expect(res.data).toMatchObject({ acceptedLearners: 1, attendanceRate: 1 });
    expect(res.data.highDemandAreas).toHaveLength(1);
  });

  it('requires sign-in', async () => {
    actAs(null);
    expect((await dashboardGET(req('GET', '/api/analytics/dashboard'), ctx())).status).toBe(401);
  });
});
