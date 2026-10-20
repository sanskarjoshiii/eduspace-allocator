import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

import { Types } from 'mongoose';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import { Allocation, Course, CourseOffering, DemandInsight, Enrollment, LearningRequest, Space } from '@/server/models';
import { GET as mapGET } from '@/app/api/map/route';
import type { SessionUser } from '@/server/auth/session';
import type { MapPayload } from '@/server/dto/map';

let admin: SessionUser;
let provider: SessionUser;
let otherProvider: SessionUser;
let sg: SessionUser;
let otherSg: SessionUser;
let learnerA: SessionUser;
let learnerB: SessionUser;
let otherLearner: SessionUser;
let kothrud: { _id: Types.ObjectId };
let python: { _id: Types.ObjectId };

// Distinctive exact request points, nowhere near any area centre or space.
const EXACT_A: [number, number] = [73.812347, 18.501239];
const EXACT_B: [number, number] = [73.879123, 18.547891];
const EXACT_C: [number, number] = [73.803571, 18.512468];
const SECRET = [...EXACT_A, ...EXACT_B, ...EXACT_C].map(String);

const getMap = async (u: SessionUser, qs = '') => {
  actAs(u);
  const res = await json<MapPayload>(await mapGET(req('GET', `/api/map${qs}`), ctx()));
  expect(res.status).toBe(200);
  return res.data;
};
const leaks = (payload: unknown) => {
  const body = JSON.stringify(payload);
  return SECRET.filter((n) => body.includes(n));
};

beforeAll(async () => {
  admin = await makeUser('Administrator');
  provider = await makeUser('CourseProvider');
  otherProvider = await makeUser('CourseProvider');
  sg = await makeUser('SpaceGiver');
  otherSg = await makeUser('SpaceGiver');
  kothrud = await makeArea({ name: 'Kothrud', lng: 73.8077, lat: 18.5074 });
  const vimanNagar = await makeArea({ name: 'Viman Nagar', lng: 73.9143, lat: 18.5679 });
  learnerA = await makeUser('Learner', { areaId: kothrud._id.toString() });
  learnerB = await makeUser('Learner', { areaId: vimanNagar._id.toString() });
  otherLearner = await makeUser('Learner', { areaId: kothrud._id.toString() });
  python = await makeCategory('Python');

  const mySpace = await Space.create({
    ownerUserId: sg.id, name: 'Sunrise Plaza', location: { type: 'Point', coordinates: [73.81, 18.505] }, areaId: kothrud._id, seatCapacity: 30,
    slots: [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, { dayOfWeek: 6, startTime: '10:00', endTime: '13:00' }],
  });
  await Space.create({
    ownerUserId: otherSg.id, name: 'Closed Hall', location: { type: 'Point', coordinates: [73.82, 18.52] }, areaId: kothrud._id, seatCapacity: 20,
    isActive: false, slots: [{ dayOfWeek: 2, startTime: '10:00', endTime: '12:00' }],
  });
  const course = await Course.create({ providerUserId: provider.id, title: 'Python', categoryId: python._id });
  const offering = await CourseOffering.create({
    courseId: course._id, providerUserId: provider.id, title: 'Python Basics', categoryId: python._id, batchSize: 10,
    sessionMinutes: 120, durationWeeks: 8, startDate: new Date(), status: 'Allocated',
  });
  const alloc = await Allocation.create({
    offeringId: offering._id, spaceId: mySpace._id, providerUserId: provider.id, spaceOwnerUserId: sg.id,
    session: { dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, score: 0.8, strategy: 'balanced', status: 'Scheduled',
  });
  const mkReq = (u: SessionUser, areaId: Types.ObjectId, point: [number, number], status: string) =>
    LearningRequest.create({
      learnerUserId: u.id, learnerProfileId: u.ownerRefId, categoryId: python._id, areaId, location: { type: 'Point', coordinates: point },
      audience: 'Adults', maxDistanceKm: 5, startMonth: '2026-11', durationMonths: 3, consentShared: true, consentAt: new Date(), status,
    });
  const ra = await mkReq(learnerA, kothrud._id, EXACT_A, 'Accepted');
  const rb = await mkReq(learnerB, vimanNagar._id, EXACT_B, 'Offered');
  await mkReq(otherLearner, kothrud._id, EXACT_C, 'Submitted');
  await Enrollment.create({ requestId: ra._id, learnerUserId: learnerA.id, offeringId: offering._id, allocationId: alloc._id, status: 'Accepted' });
  await Enrollment.create({ requestId: rb._id, learnerUserId: learnerB.id, offeringId: offering._id, allocationId: alloc._id, status: 'Offered' });
  await DemandInsight.create({ areaId: kothrud._id, categoryId: python._id, level: 'High', demand: 12, seatsOffered: 10, gap: 2 });
});

describe('GET /api/map privacy', () => {
  it('never returns exact learner coordinates to providers, Space Givers or other learners', async () => {
    for (const u of [provider, otherProvider, sg, otherSg, otherLearner, learnerB]) {
      const payload = await getMap(u);
      expect(leaks(payload), `leak for ${u.role} ${u.name}`).toEqual([]);
    }
  });

  it('draws allocation lines to learner AREA CENTRES only', async () => {
    const payload = await getMap(provider, '?layers=allocations');
    const line = payload.layers.allocations![0]!;
    expect(line.from).toEqual([73.81, 18.505]);
    expect(line.to.map((t) => t.center).sort()).toEqual([[73.8077, 18.5074], [73.9143, 18.5679]].sort());
    expect(line.to.every((t) => t.learners === 1)).toBe(true);
    expect(leaks(await getMap(admin))).toEqual([]);
  });
});

describe('GET /api/map layers and scope', () => {
  it('scopes allocation lines to the owner', async () => {
    expect((await getMap(sg, '?layers=allocations')).layers.allocations).toHaveLength(1);
    expect((await getMap(otherSg, '?layers=allocations')).layers.allocations).toHaveLength(0);
    expect((await getMap(otherProvider, '?layers=allocations')).layers.allocations).toHaveLength(0);
    expect((await getMap(admin, '?layers=allocations')).layers.allocations).toHaveLength(1);
  });

  it('shows spaces by status with owner-only hours, and filters available only', async () => {
    const own = await getMap(sg, '?layers=spaces');
    const plaza = own.layers.spaces!.find((s) => s.name === 'Sunrise Plaza')!;
    expect(plaza).toMatchObject({ status: 'available', owned: true, openHours: 5, bookedHours: 2 });
    expect(own.layers.spaces!.map((s) => s.name)).not.toContain('Closed Hall');

    const pub = await getMap(provider, '?layers=spaces');
    expect(pub.layers.spaces!.find((s) => s.name === 'Sunrise Plaza')).toMatchObject({ owned: false, openHours: null, bookedHours: null });

    const all = await getMap(admin, '?layers=spaces');
    expect(all.layers.spaces!.find((s) => s.name === 'Closed Hall')!.status).toBe('inactive');
    const avail = await getMap(admin, '?layers=spaces&availableOnly=1');
    expect(avail.layers.spaces!.map((s) => s.name)).toEqual(['Sunrise Plaza']);
  });

  it('gives Space Givers their unused hours and everyone aggregated demand', async () => {
    const unused = (await getMap(sg, '?layers=unused')).layers.unused!;
    expect(unused).toEqual([expect.objectContaining({ spaceName: 'Sunrise Plaza', freeHours: 3, freeSlots: ['Sat 10:00–13:00'] })]);
    expect((await getMap(provider, '?layers=unused')).layers.unused).toBeUndefined();

    // The level filter uses each area's run-assigned demand level; none is set yet.
    expect((await getMap(otherLearner, '?layers=demand&level=High')).layers.demand).toEqual([]);
    const kothrudRow = (await getMap(provider, '?layers=demand')).layers.demand!.find((d) => d.areaName === 'Kothrud')!;
    expect(kothrudRow).toMatchObject({ center: [73.8077, 18.5074], openRequests: 1, demand: 12, gap: 2 });
  });

  it('shows a learner nearby confirmed classes with seats, measured from their AREA CENTRE', async () => {
    const payload = await getMap(otherLearner, '?layers=offers,allocations,unused');
    expect(payload.layers.allocations).toBeUndefined();
    expect(payload.layers.unused).toBeUndefined();
    expect(payload.home).toMatchObject({ areaName: 'Kothrud', center: [73.8077, 18.5074] });
    const offer = payload.layers.offers![0]!;
    expect(offer).toMatchObject({ title: 'Python Basics', spaceName: 'Sunrise Plaza', seatsLeft: 8, session: 'Mon 18:00–20:00' });
    expect(offer.distanceKm).toBeCloseTo(0.4, 1);
    // Viman Nagar is about 12 km away: outside the 5 km request radius.
    expect((await getMap(learnerB, '?layers=offers')).layers.offers).toHaveLength(0);
    expect((await getMap(provider, '?layers=offers')).layers.offers).toBeUndefined();
  });

  it('validates layer names and requires sign-in', async () => {
    actAs(provider);
    expect((await mapGET(req('GET', '/api/map?layers=spaces,heat'), ctx())).status).toBe(422);
    actAs(null);
    expect((await mapGET(req('GET', '/api/map'), ctx())).status).toBe(401);
  });
});
