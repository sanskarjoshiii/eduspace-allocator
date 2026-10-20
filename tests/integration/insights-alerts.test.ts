import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

import { Types } from 'mongoose';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import {
  AlertState, Allocation, Course, CourseOffering, DemandInsight, LearningRequest, Notification, Space,
} from '@/server/models';
import { updateSettings } from '@/server/services/settings';
import { evaluateDemandAlerts } from '@/server/services/alerts';
import { GET as insightsGET } from '@/app/api/demand-insights/route';
import { GET as areasGET } from '@/app/api/demand-insights/areas/route';
import type { SessionUser } from '@/server/auth/session';
import type { AreaDemandDto, DemandInsightList } from '@/server/dto/insight';

type Doc = { _id: Types.ObjectId };
let admin: SessionUser;
let learner: SessionUser;
let spaceGiver: SessionUser;
let farSpaceGiver: SessionUser;
let provider: SessionUser;
let otherProvider: SessionUser;
let areas: (Doc & { name: string })[];
let python: Doc;
let coding: Doc;

const EXACT: [number, number] = [73.823417, 18.519283];

async function openRequests(n: number, areaId: Types.ObjectId, categoryId: Types.ObjectId) {
  const docs = [];
  for (let i = 0; i < n; i++) {
    const l = await makeUser('Learner');
    docs.push({
      learnerUserId: l.id, learnerProfileId: l.ownerRefId, categoryId, areaId, location: { type: 'Point', coordinates: EXACT },
      audience: 'Adults', maxDistanceKm: 10, startMonth: '2026-11', durationMonths: 3, consentShared: true, consentAt: new Date(), status: 'Submitted',
    });
  }
  await LearningRequest.insertMany(docs);
}

beforeAll(async () => {
  admin = await makeUser('Administrator');
  spaceGiver = await makeUser('SpaceGiver');
  farSpaceGiver = await makeUser('SpaceGiver');
  provider = await makeUser('CourseProvider');
  otherProvider = await makeUser('CourseProvider');
  areas = [
    await makeArea({ name: 'Kothrud', lng: 73.8077, lat: 18.5074 }),
    await makeArea({ name: 'Karve Nagar', lng: 73.8169, lat: 18.4892 }),
    await makeArea({ name: 'Erandwane', lng: 73.8336, lat: 18.5089 }),
    await makeArea({ name: 'Aundh', lng: 73.8077, lat: 18.5590 }),
  ];
  learner = await makeUser('Learner', { areaId: areas[3]!._id.toString() });
  coding = await makeCategory('Coding');
  python = await makeCategory('Python', coding._id.toString());
  const art = await makeCategory('Art');

  await DemandInsight.insertMany([
    { areaId: areas[0]!._id, categoryId: python._id, level: 'High', demand: 40, seatsOffered: 10, gap: 30 },
    { areaId: areas[1]!._id, categoryId: python._id, level: 'Medium', demand: 20, seatsOffered: 15, gap: 5 },
    { areaId: areas[3]!._id, categoryId: art._id, level: 'Emerging', demand: 5, seatsOffered: 0, gap: 5 },
  ]);
});

describe('GET /api/demand-insights', () => {
  it('is open to every role and returns aggregated rows only', async () => {
    for (const u of [admin, learner, spaceGiver, provider]) {
      actAs(u);
      const res = await json<DemandInsightList>(await insightsGET(req('GET', '/api/demand-insights'), ctx()));
      expect(res.status).toBe(200);
      expect(res.data.items).toHaveLength(3);
      const row = res.data.items.find((r) => r.areaName === 'Kothrud')!;
      expect(Object.keys(row).sort()).toEqual(
        ['areaCenter', 'areaId', 'areaName', 'categoryId', 'categoryName', 'computedAt', 'demand', 'gap', 'isOwnArea', 'level', 'seatsOffered'],
      );
      expect(row.areaCenter).toEqual([73.8077, 18.5074]);
    }
  });

  it('puts the learner\'s own area first', async () => {
    actAs(learner);
    const res = await json<DemandInsightList>(await insightsGET(req('GET', '/api/demand-insights'), ctx()));
    expect(res.data.ownAreaId).toBe(areas[3]!._id.toString());
    expect(res.data.items[0]!.areaName).toBe('Aundh');
    expect(res.data.items[0]!.isOwnArea).toBe(true);
    actAs(admin);
    const adminRes = await json<DemandInsightList>(await insightsGET(req('GET', '/api/demand-insights'), ctx()));
    expect(adminRes.data.items[0]!.level).toBe('High');
    expect(adminRes.data.ownAreaId).toBeNull();
  });

  it('filters by area, category and level, and validates ids', async () => {
    actAs(provider);
    const byLevel = await json<DemandInsightList>(await insightsGET(req('GET', '/api/demand-insights?level=High'), ctx()));
    expect(byLevel.data.items.map((r) => r.areaName)).toEqual(['Kothrud']);
    const byCat = await json<DemandInsightList>(await insightsGET(req('GET', `/api/demand-insights?categoryId=${python._id}`), ctx()));
    expect(byCat.data.items).toHaveLength(2);
    const byArea = await json<DemandInsightList>(await insightsGET(req('GET', `/api/demand-insights?areaId=${areas[1]!._id}`), ctx()));
    expect(byArea.data.items).toHaveLength(1);
    expect((await insightsGET(req('GET', '/api/demand-insights?areaId=nope'), ctx())).status).toBe(422);
  });

  it('requires sign-in', async () => {
    actAs(null);
    expect((await insightsGET(req('GET', '/api/demand-insights'), ctx())).status).toBe(401);
    expect((await areasGET(req('GET', '/api/demand-insights/areas'), ctx())).status).toBe(401);
  });
});

describe('GET /api/demand-insights/areas', () => {
  it('returns per-area totals with open request counts and never request coordinates', async () => {
    await openRequests(2, areas[0]!._id, python._id);
    actAs(spaceGiver);
    const res = await json<{ items: AreaDemandDto[] }>(await areasGET(req('GET', '/api/demand-insights/areas'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.items).toHaveLength(4);
    const kothrud = res.data.items.find((a) => a.areaName === 'Kothrud')!;
    expect(kothrud).toMatchObject({ demand: 40, seatsOffered: 10, gap: 30, openRequests: 2, categories: 1 });
    const body = JSON.stringify(res.data);
    expect(body).not.toContain(String(EXACT[0]));
    expect(body).not.toContain(String(EXACT[1]));
    expect(body).not.toContain('learner');
    await LearningRequest.deleteMany({});
  });
});

describe('multi-area demand alert', () => {
  beforeAll(async () => {
    await updateSettings({ alertMinAreas: 3, alertMinRequests: 3, alertWindowDays: 14, maxRadiusKm: 10 }, null);
    // Space near Kothrud with a free Monday slot, and one far away (Mumbai).
    await Space.create({
      ownerUserId: spaceGiver.id, name: 'Sunrise Plaza', location: { type: 'Point', coordinates: [73.81, 18.505] }, areaId: areas[0]!._id,
      seatCapacity: 60, slots: [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }],
    });
    await Space.create({
      ownerUserId: farSpaceGiver.id, name: 'Far Hall', location: { type: 'Point', coordinates: [72.8777, 19.076] }, areaId: areas[0]!._id,
      seatCapacity: 40, slots: [{ dayOfWeek: 2, startTime: '18:00', endTime: '20:00' }],
    });
    await Course.create({ providerUserId: provider.id, title: 'Coding for All', categoryId: coding._id });
    await Course.create({ providerUserId: otherProvider.id, title: 'Watercolours', categoryId: (await makeCategory('Painting'))._id });
  });

  it('stays quiet below the area threshold', async () => {
    await openRequests(4, areas[0]!._id, python._id);
    await openRequests(3, areas[1]!._id, python._id);
    await openRequests(2, areas[2]!._id, python._id);
    expect(await evaluateDemandAlerts()).toEqual({ fired: 0 });
    expect(await Notification.countDocuments({ type: 'demand.alert' })).toBe(0);
  });

  it('fires once to nearby Space Givers with a free slot and matching providers', async () => {
    await openRequests(1, areas[2]!._id, python._id);
    expect(await evaluateDemandAlerts()).toEqual({ fired: 1 });

    const sg = await Notification.find({ type: 'demand.alert', userId: new Types.ObjectId(spaceGiver.id) }).lean();
    expect(sg).toHaveLength(1);
    expect(sg[0]!.message).toBe('3 areas near Kothrud have 10 open requests for Python. You have Mon 18:00–20:00 (60 seats) free.');
    expect(await Notification.countDocuments({ type: 'demand.alert', userId: new Types.ObjectId(farSpaceGiver.id) })).toBe(0);

    const pr = await Notification.find({ type: 'demand.alert', userId: new Types.ObjectId(provider.id) }).lean();
    expect(pr).toHaveLength(1);
    expect(pr[0]!.message).toContain('no confirmed class');
    expect(await Notification.countDocuments({ type: 'demand.alert', userId: new Types.ObjectId(otherProvider.id) })).toBe(0);

    // Same demand: no repeat.
    expect(await evaluateDemandAlerts()).toEqual({ fired: 0 });
    expect(await Notification.countDocuments({ type: 'demand.alert' })).toBe(2);
  });

  it('fires again only after demand changes', async () => {
    await openRequests(1, areas[0]!._id, python._id); // 5 in Kothrud: same bucket (size 3)
    expect(await evaluateDemandAlerts()).toEqual({ fired: 0 });
    await openRequests(3, areas[3]!._id, python._id); // a fourth area joins
    expect(await evaluateDemandAlerts()).toEqual({ fired: 1 });
    expect(await Notification.countDocuments({ type: 'demand.alert', userId: new Types.ObjectId(provider.id) })).toBe(2);
    expect(await AlertState.countDocuments({ key: `demand:${python._id}` })).toBe(1);
  });

  it('does not fire when a confirmed class covers the areas', async () => {
    await AlertState.deleteMany({});
    const course = await Course.findOne({ providerUserId: provider.id }).lean();
    const space = await Space.findOne({ ownerUserId: spaceGiver.id }).lean();
    for (const area of areas.slice(0, 2)) {
      const off = await CourseOffering.create({
        courseId: course!._id, providerUserId: provider.id, title: 'Python Basics', categoryId: python._id, batchSize: 20,
        sessionMinutes: 120, durationWeeks: 8, startDate: new Date(), targetAreaId: area._id, status: 'Allocated',
      });
      await Allocation.create({
        offeringId: off._id, spaceId: space!._id, providerUserId: provider.id, spaceOwnerUserId: spaceGiver.id,
        session: { dayOfWeek: 3, startTime: '18:00', endTime: '20:00' }, score: 0.8, strategy: 'balanced', status: 'ConfirmedByProvider',
      });
    }
    // Kothrud and Karve Nagar covered: only 2 uncovered areas remain (< 3).
    expect(await evaluateDemandAlerts()).toEqual({ fired: 0 });
    expect(await AlertState.countDocuments({})).toBe(0);
  });

  it('ignores requests outside the look-back window', async () => {
    await Allocation.deleteMany({});
    // createdAt is immutable through Mongoose, so age the requests at the driver level.
    await LearningRequest.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 30 * 86_400_000) } });
    expect(await evaluateDemandAlerts()).toEqual({ fired: 0 });
  });
});
