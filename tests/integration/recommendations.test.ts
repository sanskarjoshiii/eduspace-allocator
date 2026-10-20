import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
const { suggestFor, buildSnapshot } = vi.hoisted(() => ({
  suggestFor: vi.fn(),
  buildSnapshot: vi.fn(async () => ({ snapshot: { now: new Date().toISOString() }, settings: { strategy: 'balanced' } })),
}));
vi.mock('@/server/worker/snapshot', () => ({ buildSnapshot }));
vi.mock('@/server/services/engine-client', () => ({ getEngine: () => ({ suggestFor }) }));

import { Types } from 'mongoose';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import { Allocation, Course, CourseOffering, DemandInsight, Enrollment, LearningRequest, Space } from '@/server/models';
import { GET as recGET } from '@/app/api/recommendations/route';
import { GET as discoverGET } from '@/app/api/recommendations/discover/route';
import type { SessionUser } from '@/server/auth/session';
import type { DiscoverResult, RecommendationResult } from '@/server/services/recommendations';

type Doc = { _id: Types.ObjectId };
let admin: SessionUser;
let learner: SessionUser;
let otherLearner: SessionUser;
let provider: SessionUser;
let spaceGiver: SessionUser;
let kothrud: Doc;
let aundh: Doc;
let coding: Doc;
let python: Doc;
let webDev: Doc;
let offering: Doc;
let unmatched: Doc;
let fresh: Doc;

const EXACT: [number, number] = [73.811111, 18.502222];

const requestDoc = (u: SessionUser, categoryId: Types.ObjectId, areaId: Types.ObjectId, status: string) => ({
  learnerUserId: u.id, learnerProfileId: u.ownerRefId, categoryId, areaId, location: { type: 'Point', coordinates: EXACT }, audience: 'Adults',
  maxDistanceKm: 5, startMonth: '2026-11', durationMonths: 3, consentShared: true, consentAt: new Date(), status,
});

beforeAll(async () => {
  admin = await makeUser('Administrator');
  provider = await makeUser('CourseProvider', { name: 'Ravi' });
  spaceGiver = await makeUser('SpaceGiver');
  kothrud = await makeArea({ name: 'Kothrud', lng: 73.8077, lat: 18.5074 });
  aundh = await makeArea({ name: 'Aundh', lng: 73.8077, lat: 18.559 });
  const far = await makeArea({ name: 'Hadapsar', lng: 73.9259, lat: 18.5089 });
  learner = await makeUser('Learner', { areaId: kothrud._id.toString() });
  otherLearner = await makeUser('Learner');
  coding = await makeCategory('Coding');
  python = await makeCategory('Python', coding._id.toString());
  webDev = await makeCategory('Web Development', coding._id.toString());

  const course = await Course.create({ providerUserId: provider.id, title: 'Web Dev', categoryId: webDev._id });
  const base = { courseId: course._id, providerUserId: provider.id, categoryId: webDev._id, sessionMinutes: 120, durationWeeks: 8, startDate: new Date() };
  offering = await CourseOffering.create({ ...base, title: 'Web Basics', batchSize: 2, status: 'Open', feePerMonth: 500 });
  await CourseOffering.create({ ...base, title: 'Far Web', batchSize: 10, status: 'Open', targetAreaId: far._id });
  const full = await CourseOffering.create({ ...base, title: 'Full Web', batchSize: 1, status: 'Open', targetAreaId: kothrud._id });

  const space = await Space.create({
    ownerUserId: spaceGiver.id, name: 'Aundh Hall', location: { type: 'Point', coordinates: [73.8077, 18.53] }, areaId: aundh._id, seatCapacity: 30,
    slots: [{ dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }],
  });
  await Allocation.create({
    offeringId: offering._id, spaceId: space._id, providerUserId: provider.id, spaceOwnerUserId: spaceGiver.id,
    session: { dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }, score: 0.8, strategy: 'balanced', status: 'ConfirmedByProvider',
  });

  unmatched = await LearningRequest.create({
    ...requestDoc(learner, python._id, kothrud._id, 'Unmatched'),
    suggestions: [
      { offeringId: offering._id, categoryId: webDev._id, areaId: aundh._id, score: 0.71, reasons: ['Same group as Python', 'Saturday mornings'] },
      { offeringId: null, categoryId: python._id, areaId: aundh._id, score: 0.4, reasons: ['High demand nearby'] },
    ],
  });
  fresh = await LearningRequest.create(requestDoc(learner, python._id, kothrud._id, 'Submitted'));
  const filler = await LearningRequest.create(requestDoc(otherLearner, webDev._id, kothrud._id, 'Accepted'));
  await Enrollment.create({ requestId: filler._id, learnerUserId: otherLearner.id, offeringId: full._id, status: 'Accepted' });
  await DemandInsight.create({ areaId: aundh._id, categoryId: python._id, level: 'High', demand: 30, seatsOffered: 0, gap: 30 });
});

describe('GET /api/recommendations', () => {
  it('resolves stored suggestions to names, with distance from the area centre, and keeps the request open', async () => {
    actAs(learner);
    const res = await json<RecommendationResult>(await recGET(req('GET', `/api/recommendations?requestId=${unmatched._id}`), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.source).toBe('stored');
    expect(res.data.requestStatus).toBe('Unmatched');
    const [first, second] = res.data.items;
    expect(first).toMatchObject({
      offeringTitle: 'Web Basics', providerName: 'Ravi Org', spaceName: 'Aundh Hall', areaName: 'Aundh', categoryName: 'Web Development',
      session: 'Sat 10:00–12:00', feePerMonth: 500, score: 0.71, reasons: ['Same group as Python', 'Saturday mornings'],
    });
    // Kothrud centre (18.5074) to the hall (18.53): about 2.5 km. The exact point would give about 3.1 km.
    expect(first!.distanceKm).toBeCloseTo(2.5, 1);
    expect(second).toMatchObject({ offeringId: null, categoryName: 'Python', areaName: 'Aundh' });
    expect(JSON.stringify(res.data)).not.toContain(String(EXACT[0]));
    expect(suggestFor).not.toHaveBeenCalled();
    expect((await LearningRequest.findById(unmatched._id).lean())!.status).toBe('Unmatched');
  });

  it('computes live suggestions through the engine when none are stored', async () => {
    suggestFor.mockReturnValueOnce([{ offeringId: offering._id.toString(), categoryId: webDev._id.toString(), areaId: null, score: 0.6, reasons: ['Close by'] }]);
    actAs(admin);
    const res = await json<RecommendationResult>(await recGET(req('GET', `/api/recommendations?requestId=${fresh._id}`), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.source).toBe('live');
    expect(suggestFor).toHaveBeenCalledWith(expect.anything(), expect.anything(), fresh._id.toString());
    expect(res.data.items[0]!.offeringTitle).toBe('Web Basics');
    expect((await LearningRequest.findById(fresh._id).lean())!.status).toBe('Submitted');
  });

  it('degrades to an empty list when the engine fails', async () => {
    suggestFor.mockImplementationOnce(() => {
      throw new Error('engine down');
    });
    actAs(learner);
    const res = await json<RecommendationResult>(await recGET(req('GET', `/api/recommendations?requestId=${fresh._id}`), ctx()));
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ source: 'none', items: [] });
  });

  it('blocks other learners and other roles', async () => {
    actAs(otherLearner);
    expect((await recGET(req('GET', `/api/recommendations?requestId=${unmatched._id}`), ctx())).status).toBe(403);
    for (const u of [provider, spaceGiver]) {
      actAs(u);
      expect((await recGET(req('GET', `/api/recommendations?requestId=${unmatched._id}`), ctx())).status).toBe(403);
    }
    actAs(learner);
    expect((await recGET(req('GET', '/api/recommendations'), ctx())).status).toBe(422);
    expect((await recGET(req('GET', `/api/recommendations?requestId=${new Types.ObjectId()}`), ctx())).status).toBe(404);
  });
});

describe('GET /api/recommendations/discover', () => {
  it('lists nearby offerings with seats, high-demand and similar categories, each with reasons', async () => {
    actAs(learner);
    const res = await json<DiscoverResult>(await discoverGET(req('GET', '/api/recommendations/discover'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.areaName).toBe('Kothrud');
    const titles = res.data.offerings.map((o) => o.title);
    expect(titles).toContain('Web Basics');
    expect(titles).not.toContain('Full Web'); // no seats left
    expect(titles).not.toContain('Far Web'); // about 12.5 km away, outside the 10 km radius
    const web = res.data.offerings.find((o) => o.title === 'Web Basics')!;
    expect(web.seatsLeft).toBe(2);
    expect(web.reasons).toEqual(expect.arrayContaining(['2.5 km from your area centre', '2 seats left', 'Sat 10:00–12:00']));

    expect(res.data.highDemandCategories[0]).toMatchObject({ categoryName: 'Python' });
    expect(res.data.highDemandCategories[0]!.reasons[0]).toContain('High demand in Aundh');
    const similar = res.data.similarCategories.map((c) => c.categoryName);
    expect(similar).toEqual(expect.arrayContaining(['Coding', 'Web Development']));
    expect(similar).not.toContain('Python');
  });

  it('is for learners only', async () => {
    for (const u of [admin, provider, spaceGiver]) {
      actAs(u);
      expect((await discoverGET(req('GET', '/api/recommendations/discover'), ctx())).status).toBe(403);
    }
  });
});

