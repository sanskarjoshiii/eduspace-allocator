import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { connectDb } from '@/lib/db';
import { Allocation, AuditLog, Course, DomainEvent } from '@/server/models';
import { GET as listOfferings, POST as createOffering } from '@/app/api/offerings/route';
import { DELETE as deleteOffering, GET as getOffering, PATCH as patchOffering } from '@/app/api/offerings/[id]/route';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import type { SessionUser } from '@/server/auth/session';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

let provider: SessionUser;
let otherProvider: SessionUser;
let admin: SessionUser;
let learner: SessionUser;
let giver: SessionUser;
let courseId: string;
let categoryId: string;
let areaId: string;

type OfferingRes = { id: string; title: string; categoryId: string; status: string; maxRentPerHour?: number | null; canEdit: boolean; targetAreaName: string | null };

const body = (extra: Record<string, unknown> = {}) => ({
  courseId,
  audience: 'Adults',
  batchSize: 15,
  sessionMinutes: 90,
  durationWeeks: 12,
  startDate: '2026-11-01',
  targetAreaId: areaId,
  windows: [{ dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }],
  maxRentPerHour: 400,
  feePerMonth: 500,
  ...extra,
});

async function create(as: SessionUser, extra: Record<string, unknown> = {}) {
  actAs(as);
  return json<OfferingRes>(await createOffering(req('POST', '/api/offerings', body(extra)), ctx()));
}

beforeAll(async () => {
  await connectDb();
  provider = await makeUser('CourseProvider');
  otherProvider = await makeUser('CourseProvider');
  admin = await makeUser('Administrator');
  learner = await makeUser('Learner');
  giver = await makeUser('SpaceGiver');
  categoryId = String((await makeCategory('Guitar'))._id);
  areaId = String((await makeArea({ name: 'Aundh' }))._id);
  courseId = String((await Course.create({ providerUserId: provider.id, title: 'Acoustic Guitar', categoryId }))._id);
});

describe('offerings', () => {
  it('401 signed out; 403 for learners and space givers', async () => {
    actAs(null);
    expect((await createOffering(req('POST', '/api/offerings', body()), ctx())).status).toBe(401);
    for (const u of [learner, giver]) {
      actAs(u);
      expect((await createOffering(req('POST', '/api/offerings', body()), ctx())).status).toBe(403);
    }
  });

  it('derives title and category from the course; audit and offering.saved', async () => {
    const res = await create(provider);
    expect(res.status).toBe(201);
    expect(res.data.title).toBe('Acoustic Guitar');
    expect(res.data.categoryId).toBe(categoryId);
    expect(res.data.status).toBe('Open');
    expect(res.data.targetAreaName).toBe('Aundh');
    expect(res.data.maxRentPerHour).toBe(400);
    expect(await AuditLog.countDocuments({ entity: 'CourseOffering', action: 'create', entityId: res.data.id })).toBe(1);
    expect(await DomainEvent.countDocuments({ type: 'offering.saved', refId: res.data.id })).toBe(1);
  });

  it('validates windows, session length and status', async () => {
    const overlap = await create(provider, {
      windows: [
        { dayOfWeek: 1, startTime: '10:00', endTime: '12:00' },
        { dayOfWeek: 1, startTime: '11:00', endTime: '13:00' },
      ],
    });
    expect(overlap.status).toBe(422);
    expect((await create(provider, { windows: [{ dayOfWeek: 1, startTime: '12:00', endTime: '10:00' }] })).status).toBe(422);
    expect((await create(provider, { sessionMinutes: 180 })).status).toBe(422);
    expect((await create(provider, { sessionMinutes: 20 })).status).toBe(422);
    expect((await create(provider, { status: 'Allocated' })).status).toBe(422);
    expect((await create(provider, { status: 'Draft' })).status).toBe(201);
  });

  it('a provider cannot create an offering on another provider’s course (403)', async () => {
    expect((await create(otherProvider)).status).toBe(403);
  });

  it('cross-owner edit/delete are 403; admin can edit; provider cannot set system statuses', async () => {
    const created = await create(provider);
    actAs(otherProvider);
    expect((await patchOffering(req('PATCH', '/x', { batchSize: 1 }), ctx({ id: created.data.id }))).status).toBe(403);
    expect((await deleteOffering(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(403);

    actAs(provider);
    expect((await patchOffering(req('PATCH', '/x', { status: 'Active' }), ctx({ id: created.data.id }))).status).toBe(422);
    // Session must still fit the stored windows when only sessionMinutes changes.
    expect((await patchOffering(req('PATCH', '/x', { sessionMinutes: 150 }), ctx({ id: created.data.id }))).status).toBe(422);
    const cancelled = await json<OfferingRes>(await patchOffering(req('PATCH', '/x', { status: 'Cancelled' }), ctx({ id: created.data.id })));
    expect(cancelled.data.status).toBe('Cancelled');

    actAs(admin);
    const edited = await json<OfferingRes>(await patchOffering(req('PATCH', '/x', { status: 'Allocated', batchSize: 20 }), ctx({ id: created.data.id })));
    expect(edited.status).toBe(200);
    expect(edited.data.status).toBe('Allocated');
    expect(await AuditLog.countDocuments({ entity: 'CourseOffering', action: 'update', entityId: created.data.id })).toBe(2);
    expect(await DomainEvent.countDocuments({ type: 'offering.saved', refId: created.data.id })).toBe(3);

    actAs(provider);
    expect((await patchOffering(req('PATCH', '/x', { status: 'Open' }), ctx({ id: created.data.id }))).status).toBe(409);
  });

  it('hides drafts and the rent budget from other roles', async () => {
    const draft = await create(provider, { status: 'Draft' });
    const open = await create(provider);
    actAs(learner);
    expect((await getOffering(req('GET', '/x'), ctx({ id: draft.data.id }))).status).toBe(404);
    const one = await json<OfferingRes>(await getOffering(req('GET', '/x'), ctx({ id: open.data.id })));
    expect(one.data).not.toHaveProperty('maxRentPerHour');
    expect(one.data.canEdit).toBe(false);
    const list = await json<{ items: OfferingRes[] }>(await listOfferings(req('GET', '/api/offerings?pageSize=200'), ctx()));
    expect(list.data.items.some((o) => o.id === draft.data.id)).toBe(false);
    expect(list.data.items.every((o) => !('maxRentPerHour' in o))).toBe(true);
    actAs(provider);
    const mine = await json<{ items: OfferingRes[] }>(await listOfferings(req('GET', '/api/offerings?mine=1&status=Draft&pageSize=200'), ctx()));
    expect(mine.data.items.some((o) => o.id === draft.data.id)).toBe(true);
    const filtered = await json<{ items: OfferingRes[] }>(await listOfferings(req('GET', `/api/offerings?categoryId=${categoryId}&areaId=${areaId}`), ctx()));
    expect(filtered.data.items.length).toBeGreaterThan(0);
  });

  it('blocks deleting an offering with a booked allocation (409); deletes otherwise', async () => {
    const created = await create(provider);
    const alloc = await Allocation.create({
      offeringId: created.data.id, spaceId: new Types.ObjectId(), providerUserId: provider.id, spaceOwnerUserId: giver.id,
      session: { dayOfWeek: 6, startTime: '10:00', endTime: '11:30' }, score: 0.7, strategy: 'balanced', status: 'ConfirmedByProvider',
    });
    actAs(provider);
    expect((await deleteOffering(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(409);
    await Allocation.deleteOne({ _id: alloc._id });
    expect((await deleteOffering(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(200);
    expect(await DomainEvent.countDocuments({ type: 'offering.deleted', refId: created.data.id })).toBe(1);
    expect(await AuditLog.countDocuments({ entity: 'CourseOffering', action: 'delete', entityId: created.data.id })).toBe(1);
  });
});
