import { beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDb } from '@/lib/db';
import { AuditLog, CourseOffering, DomainEvent } from '@/server/models';
import { GET as listCourses, POST as createCourse } from '@/app/api/courses/route';
import { DELETE as deleteCourse, GET as getCourse, PATCH as patchCourse } from '@/app/api/courses/[id]/route';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeCategory, makeFacilityType, makeUser } from '../helpers/factories';
import type { SessionUser } from '@/server/auth/session';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

let provider: SessionUser;
let otherProvider: SessionUser;
let admin: SessionUser;
let learner: SessionUser;
let giver: SessionUser;
let musicId: string;
let danceId: string;
let mirrorId: string;

type CourseRes = { id: string; title: string; categoryId: string; categoryName: string; providerUserId: string; providerName: string; canEdit: boolean; requirements: unknown[] };

async function create(as: SessionUser, extra: Record<string, unknown> = {}) {
  actAs(as);
  return json<CourseRes>(
    await createCourse(
      req('POST', '/api/courses', { title: 'Hindustani Vocals', categoryId: musicId, requirements: [{ facilityTypeId: mirrorId, minQuantity: 1 }], ...extra }),
      ctx(),
    ),
  );
}

beforeAll(async () => {
  await connectDb();
  provider = await makeUser('CourseProvider');
  otherProvider = await makeUser('CourseProvider');
  admin = await makeUser('Administrator');
  learner = await makeUser('Learner');
  giver = await makeUser('SpaceGiver');
  musicId = String((await makeCategory('Music'))._id);
  danceId = String((await makeCategory('Dance'))._id);
  mirrorId = String((await makeFacilityType('Mirrors'))._id);
});

describe('courses', () => {
  it('401 signed out; 403 for learners and space givers on create', async () => {
    actAs(null);
    expect((await createCourse(req('POST', '/api/courses', { title: 'X', categoryId: musicId }), ctx())).status).toBe(401);
    for (const u of [learner, giver]) {
      actAs(u);
      expect((await createCourse(req('POST', '/api/courses', { title: 'X', categoryId: musicId }), ctx())).status).toBe(403);
    }
  });

  it('a provider creates a course with category name, partner and audit', async () => {
    const res = await create(provider);
    expect(res.status).toBe(201);
    expect(res.data.providerUserId).toBe(provider.id);
    expect(res.data.categoryName).toBe('Music');
    expect(res.data.providerName).toContain('Org');
    expect(res.data.canEdit).toBe(true);
    expect(await AuditLog.countDocuments({ entity: 'Course', action: 'create', entityId: res.data.id })).toBe(1);
    expect((await create(provider, { categoryId: '0123456789abcdef01234567' })).status).toBe(422);
  });

  it('everyone signed in can read the catalogue', async () => {
    const created = await create(provider, { title: 'Tabla Basics' });
    for (const u of [learner, giver, otherProvider]) {
      actAs(u);
      const one = await json<CourseRes>(await getCourse(req('GET', '/x'), ctx({ id: created.data.id })));
      expect(one.status).toBe(200);
      expect(one.data.canEdit).toBe(false);
      const list = await json<{ items: CourseRes[]; total: number }>(await listCourses(req('GET', '/api/courses?q=tabla'), ctx()));
      expect(list.data.items.map((c) => c.title)).toEqual(['Tabla Basics']);
    }
    actAs(provider);
    const mine = await json<{ total: number }>(await listCourses(req('GET', '/api/courses?mine=1'), ctx()));
    expect(mine.data.total).toBeGreaterThanOrEqual(2);
    actAs(otherProvider);
    const notMine = await json<{ total: number }>(await listCourses(req('GET', '/api/courses?mine=1'), ctx()));
    expect(notMine.data.total).toBe(0);
  });

  it('cross-owner edit and delete are 403; administrators can edit anything', async () => {
    const created = await create(provider);
    actAs(otherProvider);
    expect((await patchCourse(req('PATCH', '/x', { title: 'Stolen' }), ctx({ id: created.data.id }))).status).toBe(403);
    expect((await deleteCourse(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(403);
    actAs(admin);
    const edited = await json<CourseRes>(await patchCourse(req('PATCH', '/x', { title: 'Edited by admin' }), ctx({ id: created.data.id })));
    expect(edited.status).toBe(200);
    expect(edited.data.title).toBe('Edited by admin');
    expect(await AuditLog.countDocuments({ entity: 'Course', action: 'update', entityId: created.data.id, actorId: admin.id })).toBe(1);
  });

  it('cascades title and category to offerings and emits offering.saved', async () => {
    const created = await create(provider, { title: 'Kathak' });
    const offering = await CourseOffering.create({
      courseId: created.data.id, providerUserId: provider.id, title: 'Kathak', categoryId: musicId,
      batchSize: 10, sessionMinutes: 60, durationWeeks: 8, startDate: new Date(),
    });
    actAs(provider);
    await patchCourse(req('PATCH', '/x', { title: 'Kathak for Beginners', categoryId: danceId }), ctx({ id: created.data.id }));
    const after = await CourseOffering.findById(offering._id).lean();
    expect(after?.title).toBe('Kathak for Beginners');
    expect(String(after?.categoryId)).toBe(danceId);
    expect(await DomainEvent.countDocuments({ type: 'offering.saved', refId: offering._id })).toBe(1);
    // A course with offerings cannot be deleted.
    expect((await deleteCourse(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(409);
    await CourseOffering.deleteOne({ _id: offering._id });
    expect((await deleteCourse(req('DELETE', '/x'), ctx({ id: created.data.id }))).status).toBe(200);
    expect(await AuditLog.countDocuments({ entity: 'Course', action: 'delete', entityId: created.data.id })).toBe(1);
  });

  it('administrators can create a course for a provider', async () => {
    const res = await create(admin, { providerUserId: provider.id });
    expect(res.status).toBe(201);
    expect(res.data.providerUserId).toBe(provider.id);
    expect((await create(admin, { providerUserId: learner.id })).status).toBe(422);
    // A provider cannot create for someone else.
    expect((await create(provider, { providerUserId: otherProvider.id })).status).toBe(422);
  });
});
