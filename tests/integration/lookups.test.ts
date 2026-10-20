import { beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDb } from '@/lib/db';
import { AuditLog, Course, Space } from '@/server/models';
import { GET as listFacilityTypes, POST as createFacilityType } from '@/app/api/facility-types/route';
import { DELETE as deleteFacilityType, PATCH as patchFacilityType } from '@/app/api/facility-types/[id]/route';
import { GET as listCategories, POST as createCategory } from '@/app/api/categories/route';
import { DELETE as deleteCategory, PATCH as patchCategory } from '@/app/api/categories/[id]/route';
import { GET as listAreas, POST as createArea } from '@/app/api/areas/route';
import { DELETE as deleteArea, GET as getArea } from '@/app/api/areas/[id]/route';
import { GET as allLookups } from '@/app/api/lookups/route';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeFacilityType, makeUser } from '../helpers/factories';
import type { SessionUser } from '@/server/auth/session';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

let admin: SessionUser;
let learner: SessionUser;

beforeAll(async () => {
  await connectDb();
  admin = await makeUser('Administrator');
  learner = await makeUser('Learner');
});

describe('lookups', () => {
  it('administrators create, update and delete facility types; others get 401/403', async () => {
    actAs(null);
    expect((await createFacilityType(req('POST', '/api/facility-types', { name: 'Projector' }), ctx())).status).toBe(401);
    actAs(learner);
    expect((await createFacilityType(req('POST', '/api/facility-types', { name: 'Projector' }), ctx())).status).toBe(403);

    actAs(admin);
    const created = await json<{ id: string; name: string; unit: string }>(
      await createFacilityType(req('POST', '/api/facility-types', { name: 'Projector', unit: 'units' }), ctx()),
    );
    expect(created.status).toBe(201);
    expect(await AuditLog.countDocuments({ entity: 'FacilityType', action: 'create', entityId: created.data.id })).toBe(1);

    actAs(learner);
    expect((await patchFacilityType(req('PATCH', '/x', { name: 'Hack' }), ctx({ id: created.data.id }))).status).toBe(403);
    expect((await deleteFacilityType(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(403);

    actAs(admin);
    const patched = await json<{ name: string }>(await patchFacilityType(req('PATCH', '/x', { name: 'HD Projector' }), ctx({ id: created.data.id })));
    expect(patched.data.name).toBe('HD Projector');
    expect(await AuditLog.countDocuments({ entity: 'FacilityType', action: 'update', entityId: created.data.id })).toBe(1);

    // Anyone (even signed out) can read lookups.
    actAs(null);
    const list = await json<{ items: { name: string }[] }>(await listFacilityTypes(req('GET', '/api/facility-types'), ctx()));
    expect(list.status).toBe(200);
    expect(list.data.items.map((i) => i.name)).toContain('HD Projector');

    actAs(admin);
    expect((await deleteFacilityType(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(200);
    expect(await AuditLog.countDocuments({ entity: 'FacilityType', action: 'delete', entityId: created.data.id })).toBe(1);
  });

  it('blocks deleting a referenced facility type, category or area (409)', async () => {
    const ft = await makeFacilityType();
    const cat = await makeCategory();
    const area = await makeArea();
    const owner = await makeUser('SpaceGiver');
    const provider = await makeUser('CourseProvider');
    await Space.create({
      ownerUserId: owner.id, name: 'Hall', location: { type: 'Point', coordinates: [73.8, 18.5] }, areaId: area._id, seatCapacity: 10,
      facilities: [{ facilityTypeId: ft._id, quantity: 2, workingQuantity: 2 }],
    });
    await Course.create({ providerUserId: provider.id, title: 'Guitar', categoryId: cat._id });
    actAs(admin);
    expect((await deleteFacilityType(req('DELETE', '/x'), ctx({ id: String(ft._id) }))).status).toBe(409);
    expect((await deleteCategory(req('DELETE', '/x'), ctx({ id: String(cat._id) }))).status).toBe(409);
    expect((await deleteArea(req('DELETE', '/x'), ctx({ id: String(area._id) }))).status).toBe(409);
  });

  it('manages categories with parents and filters by parentId', async () => {
    actAs(admin);
    const parent = await json<{ id: string }>(await createCategory(req('POST', '/api/categories', { name: 'Performing Arts' }), ctx()));
    const child = await json<{ id: string; parentId: string }>(
      await createCategory(req('POST', '/api/categories', { name: 'Kathak', parentId: parent.data.id }), ctx()),
    );
    expect(child.data.parentId).toBe(parent.data.id);
    // A category cannot become its own ancestor.
    expect((await patchCategory(req('PATCH', '/x', { parentId: child.data.id }), ctx({ id: parent.data.id }))).status).toBe(422);
    const filtered = await json<{ items: { name: string }[] }>(await listCategories(req('GET', `/api/categories?parentId=${parent.data.id}`), ctx()));
    expect(filtered.data.items.map((c) => c.name)).toEqual(['Kathak']);
    // Parent with a child cannot be deleted; the child can.
    expect((await deleteCategory(req('DELETE', '/x'), ctx({ id: parent.data.id }))).status).toBe(409);
    expect((await deleteCategory(req('DELETE', '/x'), ctx({ id: child.data.id }))).status).toBe(200);
  });

  it('creates areas and returns the nearest for ?near=lng,lat', async () => {
    actAs(admin);
    const body = { center: { type: 'Point', coordinates: [73.8077, 18.5074] }, population: 1000, studentCount: 100, literacyRate: 90, incomeScore: 60, incomeGroup: 'Medium' };
    const kothrud = await json<{ id: string }>(await createArea(req('POST', '/api/areas', { ...body, name: 'Kothrud' }), ctx()));
    expect(kothrud.status).toBe(201);
    await json(await createArea(req('POST', '/api/areas', { ...body, name: 'Viman Nagar', center: { type: 'Point', coordinates: [73.9143, 18.5679] } }), ctx()));
    actAs(learner);
    expect((await createArea(req('POST', '/api/areas', { ...body, name: 'Nope' }), ctx())).status).toBe(403);

    actAs(null);
    const near = await json<{ items: { name: string; distanceKm: number }[] }>(await listAreas(req('GET', '/api/areas?near=73.91,18.56&limit=1'), ctx()));
    expect(near.status).toBe(200);
    expect(near.data.items).toHaveLength(1);
    expect(near.data.items[0]!.name).toBe('Viman Nagar');
    expect(near.data.items[0]!.distanceKm).toBeLessThan(2);
    const one = await json<{ name: string; center: number[] }>(await getArea(req('GET', '/x'), ctx({ id: kothrud.data.id })));
    expect(one.data.center).toEqual([73.8077, 18.5074]);
  });

  it('GET /api/lookups returns all three lists', async () => {
    actAs(null);
    const res = await json<{ facilityTypes: unknown[]; categories: unknown[]; areas: unknown[] }>(await allLookups(req('GET', '/api/lookups'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.facilityTypes.length).toBeGreaterThan(0);
    expect(res.data.categories.length).toBeGreaterThan(0);
    expect(res.data.areas.length).toBeGreaterThan(0);
  });
});
