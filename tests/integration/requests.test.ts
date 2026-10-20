import { beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDb } from '@/lib/db';
import { AuditLog, DomainEvent, LearnerProfile, LearningRequest, Notification } from '@/server/models';
import { GET as listRequests, POST as createRequest } from '@/app/api/requests/route';
import { GET as listMine } from '@/app/api/requests/mine/route';
import { GET as listMatched } from '@/app/api/requests/matched/route';
import { GET as getRequest, PATCH as patchRequest } from '@/app/api/requests/[id]/route';
import { POST as cancelRequest } from '@/app/api/requests/[id]/cancel/route';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import type { SessionUser } from '@/server/auth/session';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

let learner: SessionUser;
let otherLearner: SessionUser;
let admin: SessionUser;
let provider: SessionUser;
let giver: SessionUser;
let categoryId: string;
let kothrudId: string;
let vimanId: string;

type RequestRes = {
  id: string;
  areaId: string;
  areaName: string;
  location: [number, number];
  status: string;
  audience: string;
  categoryName: string;
  consentAt: string;
  statusTimeline?: { status: string }[];
};

const body = (extra: Record<string, unknown> = {}) => ({
  categoryId,
  location: { type: 'Point', coordinates: [73.81234, 18.50987] },
  maxDistanceKm: 5,
  startMonth: '2026-12',
  durationMonths: 3,
  consentShared: true,
  windows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }],
  budgetPerMonth: 800,
  ...extra,
});

async function create(as: SessionUser, extra: Record<string, unknown> = {}) {
  actAs(as);
  return json<RequestRes>(await createRequest(req('POST', '/api/requests', body(extra)), ctx()));
}

beforeAll(async () => {
  await connectDb();
  learner = await makeUser('Learner');
  otherLearner = await makeUser('Learner');
  admin = await makeUser('Administrator');
  provider = await makeUser('CourseProvider');
  giver = await makeUser('SpaceGiver');
  categoryId = String((await makeCategory('Spoken English'))._id);
  kothrudId = String((await makeArea({ name: 'Kothrud', lng: 73.8077, lat: 18.5074 }))._id);
  vimanId = String((await makeArea({ name: 'Viman Nagar', lng: 73.9143, lat: 18.5679 }))._id);
  await LearnerProfile.updateOne({ userId: otherLearner.id }, { $set: { ageBand: '60+' } });
});

describe('learning requests', () => {
  it('only learners can submit (401 / 403)', async () => {
    actAs(null);
    expect((await createRequest(req('POST', '/api/requests', body()), ctx())).status).toBe(401);
    for (const u of [admin, provider, giver]) {
      actAs(u);
      expect((await createRequest(req('POST', '/api/requests', body()), ctx())).status).toBe(403);
    }
  });

  it('snaps to the nearest area, sets audience and consent, audits, emits and notifies', async () => {
    const res = await create(learner);
    expect(res.status).toBe(201);
    expect(res.data.areaId).toBe(kothrudId);
    expect(res.data.areaName).toBe('Kothrud');
    expect(res.data.location).toEqual([73.81234, 18.50987]);
    expect(res.data.status).toBe('Submitted');
    expect(res.data.audience).toBe('Adults');
    expect(res.data.consentAt).toBeTruthy();
    expect(res.data.categoryName).toBe('Spoken English');
    const auditRow = await AuditLog.findOne({ entity: 'LearningRequest', action: 'create', entityId: res.data.id }).lean();
    expect(auditRow).toBeTruthy();
    expect(JSON.stringify(auditRow?.diff)).not.toContain('73.81234');
    expect(await DomainEvent.countDocuments({ type: 'request.saved', refId: res.data.id })).toBe(1);
    const note = await Notification.findOne({ userId: learner.id, type: 'request.received' }).lean();
    expect(note?.message).toContain('Spoken English');

    const senior = await create(otherLearner, { location: { type: 'Point', coordinates: [73.91, 18.565] } });
    expect(senior.data.audience).toBe('Seniors');
    expect(senior.data.areaId).toBe(vimanId);
  });

  it('rejects a request without consent (422 "Consent is required")', async () => {
    const res = await json<unknown>(await createRequest(req('POST', '/api/requests', body({ consentShared: false })), ctx()));
    expect(res.status).toBe(422);
    const details = (res.error as unknown as { details: { fieldErrors: Record<string, string[]> } }).details;
    expect(details.fieldErrors.consentShared).toEqual(['Consent is required']);
  });

  it('rejects a location outside the service area (422)', async () => {
    const res = await create(learner, { location: { type: 'Point', coordinates: [72.8777, 19.076] } });
    expect(res.status).toBe(422);
    expect(res.error?.message).toBe('This location is outside the service area');
  });

  it('validates distance, start month and windows', async () => {
    expect((await create(learner, { maxDistanceKm: 0.1 })).status).toBe(422);
    expect((await create(learner, { maxDistanceKm: 60 })).status).toBe(422);
    expect((await create(learner, { startMonth: '2026-13' })).status).toBe(422);
    expect(
      (await create(learner, { windows: [{ dayOfWeek: 1, startTime: '10:00', endTime: '12:00' }, { dayOfWeek: 1, startTime: '11:00', endTime: '12:30' }] })).status,
    ).toBe(422);
  });

  it('scopes lists: learners see only their own; admins see all; unmatched partners see none', async () => {
    await create(learner);
    await create(otherLearner);
    actAs(learner);
    const own = await json<{ items: RequestRes[]; total: number }>(await listRequests(req('GET', '/api/requests'), ctx()));
    const mine = await json<{ items: RequestRes[]; total: number }>(await listMine(req('GET', '/api/requests/mine'), ctx()));
    const ownCount = await LearningRequest.countDocuments({ learnerUserId: learner.id });
    expect(own.data.total).toBe(ownCount);
    expect(mine.data.total).toBe(ownCount);
    actAs(admin);
    const all = await json<{ total: number }>(await listRequests(req('GET', '/api/requests'), ctx()));
    expect(all.data.total).toBe(await LearningRequest.countDocuments());
    const filtered = await json<{ items: RequestRes[] }>(await listRequests(req('GET', `/api/requests?areaId=${vimanId}`), ctx()));
    expect(filtered.data.items.every((r) => r.areaId === vimanId)).toBe(true);
    for (const u of [provider, giver]) {
      actAs(u);
      expect((await json<{ total: number }>(await listRequests(req('GET', '/api/requests'), ctx()))).data.total).toBe(0);
      expect((await json<{ total: number }>(await listMatched(req('GET', '/api/requests/matched'), ctx()))).data.total).toBe(0);
    }
    actAs(learner);
    expect((await listMatched(req('GET', '/api/requests/matched'), ctx())).status).toBe(403);
    actAs(provider);
    expect((await listMine(req('GET', '/api/requests/mine'), ctx())).status).toBe(403);
  });

  it('GET by id: owner and admin get the full DTO with a timeline; everyone else 404', async () => {
    const created = await create(learner);
    actAs(learner);
    const own = await json<RequestRes>(await getRequest(req('GET', '/x'), ctx({ id: created.data.id })));
    expect(own.data.location).toEqual([73.81234, 18.50987]);
    expect(own.data.statusTimeline?.[0]?.status).toBe('Submitted');
    actAs(admin);
    expect((await getRequest(req('GET', '/x'), ctx({ id: created.data.id }))).status).toBe(200);
    for (const u of [otherLearner, provider, giver]) {
      actAs(u);
      const res = await getRequest(req('GET', '/x'), ctx({ id: created.data.id }));
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('73.81234');
    }
  });

  it('PATCH: owner edits while open (re-snapping the area); cross-owner 403; locked once matched (409)', async () => {
    const created = await create(learner);
    actAs(otherLearner);
    expect((await patchRequest(req('PATCH', '/x', { maxDistanceKm: 10 }), ctx({ id: created.data.id }))).status).toBe(403);
    actAs(provider);
    expect((await patchRequest(req('PATCH', '/x', { maxDistanceKm: 10 }), ctx({ id: created.data.id }))).status).toBe(403);

    actAs(learner);
    const moved = await json<RequestRes>(
      await patchRequest(req('PATCH', '/x', { location: { type: 'Point', coordinates: [73.915, 18.567] }, maxDistanceKm: 8 }), ctx({ id: created.data.id })),
    );
    expect(moved.status).toBe(200);
    expect(moved.data.areaId).toBe(vimanId);
    expect(await DomainEvent.countDocuments({ type: 'request.saved', refId: created.data.id })).toBe(2);
    expect(await AuditLog.countDocuments({ entity: 'LearningRequest', action: 'update', entityId: created.data.id })).toBe(1);
    expect((await patchRequest(req('PATCH', '/x', { consentShared: false }), ctx({ id: created.data.id }))).status).toBe(422);

    actAs(admin);
    expect((await patchRequest(req('PATCH', '/x', { notes: 'Admin note' }), ctx({ id: created.data.id }))).status).toBe(200);

    await LearningRequest.updateOne({ _id: created.data.id }, { $set: { status: 'Matched' } });
    actAs(learner);
    expect((await patchRequest(req('PATCH', '/x', { maxDistanceKm: 9 }), ctx({ id: created.data.id }))).status).toBe(409);
  });

  it('cancel: owner or admin; cross-owner 403; emits request.cancelled; second cancel 409', async () => {
    const created = await create(learner);
    actAs(otherLearner);
    expect((await cancelRequest(req('POST', '/x'), ctx({ id: created.data.id }))).status).toBe(403);
    actAs(provider);
    expect((await cancelRequest(req('POST', '/x'), ctx({ id: created.data.id }))).status).toBe(403);
    actAs(learner);
    const res = await json<RequestRes>(await cancelRequest(req('POST', '/x'), ctx({ id: created.data.id })));
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('Cancelled');
    expect(await DomainEvent.countDocuments({ type: 'request.cancelled', refId: created.data.id })).toBe(1);
    expect(await AuditLog.countDocuments({ entity: 'LearningRequest', action: 'cancel', entityId: created.data.id })).toBe(1);
    expect((await cancelRequest(req('POST', '/x'), ctx({ id: created.data.id }))).status).toBe(409);

    const other = await create(learner);
    actAs(admin);
    expect((await cancelRequest(req('POST', '/x'), ctx({ id: other.data.id }))).status).toBe(200);
  });
});
