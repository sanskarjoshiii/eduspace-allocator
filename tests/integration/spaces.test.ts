import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { connectDb } from '@/lib/db';
import { Allocation, AuditLog, CourseOffering, DomainEvent, Space } from '@/server/models';
import { GET as listSpaces, POST as createSpace } from '@/app/api/spaces/route';
import { DELETE as deleteSpace, GET as getSpace, PATCH as patchSpace } from '@/app/api/spaces/[id]/route';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeFacilityType, makeUser } from '../helpers/factories';
import type { SessionUser } from '@/server/auth/session';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

let giver: SessionUser;
let otherGiver: SessionUser;
let admin: SessionUser;
let learner: SessionUser;
let provider: SessionUser;
let kothrudId: string;
let vimanId: string;
let projectorId: string;

const body = (extra: Record<string, unknown> = {}) => ({
  name: 'Kothrud Community Hall',
  address: 'Paud Road',
  location: { type: 'Point', coordinates: [73.809, 18.506] },
  seatCapacity: 30,
  facilities: [{ facilityTypeId: projectorId, quantity: 2, workingQuantity: 1 }],
  slots: [
    { dayOfWeek: 6, startTime: '10:00', endTime: '12:00' },
    { dayOfWeek: 6, startTime: '14:00', endTime: '16:00' },
  ],
  policy: { rentPerHour: 250, approvalMode: 'manual', rules: 'No shoes on the stage', allowedAudiences: ['Adults'] },
  ...extra,
});

type SpaceRes = {
  id: string;
  areaId: string;
  areaName: string;
  visibility: string;
  canEdit: boolean;
  ownerUserId?: string;
  policy: Record<string, unknown>;
  slots: { id: string }[];
  name: string;
  seatCapacity: number;
};

async function create(as: SessionUser, extra: Record<string, unknown> = {}) {
  actAs(as);
  return json<SpaceRes>(await createSpace(req('POST', '/api/spaces', body(extra)), ctx()));
}

beforeAll(async () => {
  await connectDb();
  giver = await makeUser('SpaceGiver');
  otherGiver = await makeUser('SpaceGiver');
  admin = await makeUser('Administrator');
  learner = await makeUser('Learner');
  provider = await makeUser('CourseProvider');
  kothrudId = String((await makeArea({ name: 'Kothrud', lng: 73.8077, lat: 18.5074 }))._id);
  vimanId = String((await makeArea({ name: 'Viman Nagar', lng: 73.9143, lat: 18.5679 }))._id);
  projectorId = String((await makeFacilityType('Projector'))._id);
});

describe('spaces', () => {
  it('requires sign-in and the Space Giver or Administrator role to create', async () => {
    actAs(null);
    expect((await createSpace(req('POST', '/api/spaces', body()), ctx())).status).toBe(401);
    expect((await listSpaces(req('GET', '/api/spaces'), ctx())).status).toBe(401);
    actAs(learner);
    expect((await createSpace(req('POST', '/api/spaces', body()), ctx())).status).toBe(403);
    actAs(provider);
    expect((await createSpace(req('POST', '/api/spaces', body()), ctx())).status).toBe(403);
  });

  it('creates a space snapped to the nearest area, with audit and a space.saved event', async () => {
    const res = await create(giver);
    expect(res.status).toBe(201);
    expect(res.data.areaId).toBe(kothrudId);
    expect(res.data.areaName).toBe('Kothrud');
    expect(res.data.visibility).toBe('full');
    expect(res.data.ownerUserId).toBe(giver.id);
    expect(res.data.policy).toMatchObject({ rentPerHour: 250, approvalMode: 'manual', rules: 'No shoes on the stage' });
    expect(await AuditLog.countDocuments({ entity: 'Space', action: 'create', entityId: res.data.id, ownerUserId: giver.id })).toBe(1);
    expect(await DomainEvent.countDocuments({ type: 'space.saved', refId: res.data.id })).toBe(1);
  });

  it('honours an explicit areaId and rejects an unknown one', async () => {
    const res = await create(giver, { areaId: vimanId });
    expect(res.data.areaId).toBe(vimanId);
    const bad = await create(giver, { areaId: new Types.ObjectId().toString() });
    expect(bad.status).toBe(422);
  });

  it('rejects a location outside the service area (422)', async () => {
    const res = await create(giver, { location: { type: 'Point', coordinates: [72.8777, 19.076] } });
    expect(res.status).toBe(422);
    expect(res.error?.message).toBe('This location is outside the service area');
  });

  it('rejects overlapping slots and workingQuantity above quantity (422)', async () => {
    const overlap = await create(giver, {
      slots: [
        { dayOfWeek: 1, startTime: '10:00', endTime: '12:00' },
        { dayOfWeek: 1, startTime: '11:30', endTime: '13:00' },
      ],
    });
    expect(overlap.status).toBe(422);
    const facilities = await create(giver, { facilities: [{ facilityTypeId: projectorId, quantity: 1, workingQuantity: 3 }] });
    expect(facilities.status).toBe(422);
    const unknownFacility = await create(giver, { facilities: [{ facilityTypeId: new Types.ObjectId().toString(), quantity: 1, workingQuantity: 1 }] });
    expect(unknownFacility.status).toBe(422);
  });

  it('shows public fields to non-owners and hides rent, approval mode and rules', async () => {
    const created = await create(giver);
    for (const viewer of [learner, provider, otherGiver]) {
      actAs(viewer);
      const one = await json<SpaceRes>(await getSpace(req('GET', '/x'), ctx({ id: created.data.id })));
      expect(one.status).toBe(200);
      expect(one.data.visibility).toBe('public');
      expect(one.data.canEdit).toBe(false);
      expect(one.data.policy).not.toHaveProperty('rentPerHour');
      expect(one.data.policy).not.toHaveProperty('approvalMode');
      expect(one.data.policy).not.toHaveProperty('rules');
      expect(one.data).not.toHaveProperty('ownerUserId');
      expect(JSON.stringify(one.data)).not.toContain('No shoes on the stage');
      const list = await json<{ items: SpaceRes[] }>(await listSpaces(req('GET', '/api/spaces'), ctx()));
      expect(list.data.items.every((s) => !('rentPerHour' in s.policy))).toBe(true);
    }
    actAs(admin);
    const asAdmin = await json<SpaceRes>(await getSpace(req('GET', '/x'), ctx({ id: created.data.id })));
    expect(asAdmin.data.visibility).toBe('full');
    expect(asAdmin.data.policy.rentPerHour).toBe(250);
  });

  it('only the owner or an administrator can edit or delete (403 otherwise)', async () => {
    const created = await create(giver);
    actAs(otherGiver);
    expect((await patchSpace(req('PATCH', '/x', { name: 'Mine now' }), ctx({ id: created.data.id }))).status).toBe(403);
    expect((await deleteSpace(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(403);
    actAs(learner);
    expect((await patchSpace(req('PATCH', '/x', { name: 'Mine now' }), ctx({ id: created.data.id }))).status).toBe(403);

    actAs(admin);
    const edited = await json<SpaceRes>(await patchSpace(req('PATCH', '/x', { name: 'Renamed by admin', policy: { rentPerHour: 300 } }), ctx({ id: created.data.id })));
    expect(edited.status).toBe(200);
    expect(edited.data.name).toBe('Renamed by admin');
    // Policy merges: the other fields keep their values.
    expect(edited.data.policy).toMatchObject({ rentPerHour: 300, approvalMode: 'manual', rules: 'No shoes on the stage' });
    expect(await AuditLog.countDocuments({ entity: 'Space', action: 'update', entityId: created.data.id, actorId: admin.id })).toBe(1);
    expect(await DomainEvent.countDocuments({ type: 'space.saved', refId: created.data.id })).toBe(2);
  });

  it('owner edits re-snap the area and reject overlapping slots', async () => {
    const created = await create(giver);
    actAs(giver);
    const moved = await json<SpaceRes>(await patchSpace(req('PATCH', '/x', { location: { type: 'Point', coordinates: [73.912, 18.566] } }), ctx({ id: created.data.id })));
    expect(moved.data.areaId).toBe(vimanId);
    const bad = await patchSpace(
      req('PATCH', '/x', { slots: [{ dayOfWeek: 2, startTime: '09:00', endTime: '11:00' }, { dayOfWeek: 2, startTime: '10:00', endTime: '12:00' }] }),
      ctx({ id: created.data.id }),
    );
    expect(bad.status).toBe(422);
    const keep = await json<SpaceRes>(
      await patchSpace(req('PATCH', '/x', { slots: [{ id: created.data.slots[0]!.id, dayOfWeek: 6, startTime: '10:00', endTime: '11:00' }] }), ctx({ id: created.data.id })),
    );
    expect(keep.data.slots).toHaveLength(1);
    expect(keep.data.slots[0]!.id).toBe(created.data.slots[0]!.id);
  });

  it('lists with ?mine=1, ?areaId and ?q, paginated', async () => {
    actAs(otherGiver);
    await create(otherGiver, { name: 'Shivajinagar Library Room' });
    actAs(otherGiver);
    const mine = await json<{ items: SpaceRes[]; total: number; page: number; pageSize: number; pages: number }>(
      await listSpaces(req('GET', '/api/spaces?mine=1&pageSize=1'), ctx()),
    );
    expect(mine.data.total).toBe(1);
    expect(mine.data.pages).toBe(1);
    expect(mine.data.items[0]!.name).toBe('Shivajinagar Library Room');
    const q = await json<{ items: SpaceRes[] }>(await listSpaces(req('GET', '/api/spaces?q=library'), ctx()));
    expect(q.data.items.map((s) => s.name)).toEqual(['Shivajinagar Library Room']);
    const byArea = await json<{ items: SpaceRes[] }>(await listSpaces(req('GET', `/api/spaces?areaId=${vimanId}`), ctx()));
    expect(byArea.data.items.every((s) => s.areaId === vimanId)).toBe(true);
  });

  it('blocks deleting a booked space (409) and deletes otherwise with a space.deleted event', async () => {
    const created = await create(giver);
    const cat = await makeCategory();
    const offering = await CourseOffering.create({
      courseId: new Types.ObjectId(), providerUserId: provider.id, title: 'Guitar', categoryId: cat._id,
      batchSize: 10, sessionMinutes: 60, durationWeeks: 8, startDate: new Date(),
    });
    const alloc = await Allocation.create({
      offeringId: offering._id, spaceId: created.data.id, providerUserId: provider.id, spaceOwnerUserId: giver.id,
      session: { dayOfWeek: 6, startTime: '10:00', endTime: '11:00' }, score: 0.8, strategy: 'balanced', status: 'Scheduled',
    });
    actAs(giver);
    expect((await deleteSpace(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(409);
    await Allocation.updateOne({ _id: alloc._id }, { $set: { status: 'Completed' } });
    expect((await deleteSpace(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(200);
    expect(await Space.countDocuments({ _id: created.data.id })).toBe(0);
    expect(await DomainEvent.countDocuments({ type: 'space.deleted', refId: created.data.id })).toBe(1);
    expect(await AuditLog.countDocuments({ entity: 'Space', action: 'delete', entityId: created.data.id })).toBe(1);
  });

  it('hides inactive spaces from non-owners', async () => {
    const created = await create(giver, { isActive: false, name: 'Closed Room' });
    actAs(learner);
    expect((await getSpace(req('GET', '/x'), ctx({ id: created.data.id }))).status).toBe(404);
    const list = await json<{ items: SpaceRes[] }>(await listSpaces(req('GET', '/api/spaces?q=Closed'), ctx()));
    expect(list.data.items).toHaveLength(0);
    actAs(giver);
    expect((await getSpace(req('GET', '/x'), ctx({ id: created.data.id }))).status).toBe(200);
  });
});
