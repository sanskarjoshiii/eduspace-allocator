// Authorisation and privacy matrix for the registries (PLAN 1.9, 8.3): cross-owner writes,
// stage-based learner redaction for matched partners, and exact-location leakage.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDb } from '@/lib/db';
import { Allocation, Course, CourseOffering, Enrollment, LearnerProfile, Space } from '@/server/models';
import { GET as listRequests, POST as createRequest } from '@/app/api/requests/route';
import { GET as listMatched } from '@/app/api/requests/matched/route';
import { GET as getRequest, PATCH as patchRequest } from '@/app/api/requests/[id]/route';
import { POST as cancelRequest } from '@/app/api/requests/[id]/cancel/route';
import { DELETE as deleteSpace, PATCH as patchSpace } from '@/app/api/spaces/[id]/route';
import { DELETE as deleteCourse, PATCH as patchCourse } from '@/app/api/courses/[id]/route';
import { DELETE as deleteOffering, PATCH as patchOffering } from '@/app/api/offerings/[id]/route';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import type { SessionUser } from '@/server/auth/session';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

// Distinctive coordinates and contact details we can scan responses for.
const A_POINT: [number, number] = [73.81234, 18.50987];
const B_POINT: [number, number] = [73.80456, 18.50321];
const C_POINT: [number, number] = [73.81777, 18.51333];
const SECRET_STRINGS = ['73.81234', '18.50987', '73.80456', '18.50321', '73.81777', '18.51333'];
const A_PHONE = '+91 90000 11111';
const B_PHONE = '+91 90000 22222';
const B_EMAIL = 'learner.b@contact.test';

let learnerA: SessionUser;
let learnerB: SessionUser;
let learnerC: SessionUser;
let provider: SessionUser;
let otherProvider: SessionUser;
let giver: SessionUser;
let otherGiver: SessionUser;
let admin: SessionUser;
let reqA: string; // enrollment Offered  -> proposed stage
let reqB: string; // enrollment Accepted -> accepted stage
let reqC: string; // enrollment Cancelled -> not disclosed
let spaceId: string;
let courseId: string;
let offeringId: string;

type Matched = { requestId: string; stage: string; relation: string; learner: Record<string, unknown> };

function expectNoSecrets(text: string): void {
  for (const s of SECRET_STRINGS) expect(text, `response leaks ${s}`).not.toContain(s);
}

async function submit(as: SessionUser, point: [number, number]): Promise<string> {
  actAs(as);
  const res = await json<{ id: string }>(
    await createRequest(
      req('POST', '/api/requests', {
        categoryId: String(categoryId),
        location: { type: 'Point', coordinates: point },
        maxDistanceKm: 5,
        startMonth: '2026-12',
        durationMonths: 3,
        consentShared: true,
      }),
      ctx(),
    ),
  );
  expect(res.status).toBe(201);
  return res.data.id;
}

let categoryId: unknown;

beforeAll(async () => {
  await connectDb();
  const area = await makeArea({ name: 'Kothrud', lng: 73.8077, lat: 18.5074 });
  categoryId = (await makeCategory('Bharatanatyam'))._id;
  [learnerA, learnerB, learnerC, provider, otherProvider, giver, otherGiver, admin] = await Promise.all([
    makeUser('Learner', { name: 'Learner Alpha' }),
    makeUser('Learner', { name: 'Learner Bravo' }),
    makeUser('Learner', { name: 'Learner Charlie' }),
    makeUser('CourseProvider'),
    makeUser('CourseProvider'),
    makeUser('SpaceGiver'),
    makeUser('SpaceGiver'),
    makeUser('Administrator'),
  ]);
  await LearnerProfile.updateOne({ userId: learnerA.id }, { $set: { contactPhone: A_PHONE, contactEmail: 'learner.a@contact.test' } });
  await LearnerProfile.updateOne({ userId: learnerB.id }, { $set: { contactPhone: B_PHONE, contactEmail: B_EMAIL } });

  reqA = await submit(learnerA, A_POINT);
  reqB = await submit(learnerB, B_POINT);
  reqC = await submit(learnerC, C_POINT);

  const space = await Space.create({
    ownerUserId: giver.id, name: 'Dance Hall', location: { type: 'Point', coordinates: [73.808, 18.507] }, areaId: area._id, seatCapacity: 20,
    slots: [{ dayOfWeek: 6, startTime: '09:00', endTime: '13:00' }],
  });
  spaceId = String(space._id);
  const course = await Course.create({ providerUserId: provider.id, title: 'Bharatanatyam Foundations', categoryId });
  courseId = String(course._id);
  const offering = await CourseOffering.create({
    courseId: course._id, providerUserId: provider.id, title: course.title, categoryId,
    batchSize: 10, sessionMinutes: 60, durationWeeks: 8, startDate: new Date('2026-12-01'),
  });
  offeringId = String(offering._id);
  const alloc = await Allocation.create({
    offeringId: offering._id, spaceId: space._id, providerUserId: provider.id, spaceOwnerUserId: giver.id,
    session: { dayOfWeek: 6, startTime: '10:00', endTime: '11:00' }, score: 0.9, strategy: 'balanced', status: 'ConfirmedByProvider',
  });
  const enrol = (requestId: string, learnerUserId: string, status: string) =>
    Enrollment.create({ requestId, learnerUserId, offeringId: offering._id, allocationId: alloc._id, status });
  await enrol(reqA, learnerA.id, 'Offered');
  await enrol(reqB, learnerB.id, 'Accepted');
  await enrol(reqC, learnerC.id, 'Cancelled');
});

describe('matched requests are redacted by stage', () => {
  it('provider: cohort before acceptance, contact after acceptance, never exact coordinates', async () => {
    actAs(provider);
    const res = await listMatched(req('GET', '/api/requests/matched'), ctx());
    const text = await res.clone().text();
    const { data } = await json<{ items: Matched[]; total: number }>(res);
    expect(data.total).toBe(2);
    const a = data.items.find((m) => m.requestId === reqA)!;
    const b = data.items.find((m) => m.requestId === reqB)!;
    expect(data.items.some((m) => m.requestId === reqC)).toBe(false);

    expect(a.stage).toBe('proposed');
    expect(a.learner.visibility).toBe('cohort');
    expect(a.learner).not.toHaveProperty('name');
    expect(a.learner).not.toHaveProperty('contactPhone');
    expect(text).not.toContain(A_PHONE);
    expect(text).not.toContain('Learner Alpha');

    expect(b.stage).toBe('accepted');
    expect(b.learner.visibility).toBe('provider-accepted');
    expect(b.learner.contactPhone).toBe(B_PHONE);
    expect(b.learner.contactEmail).toBe(B_EMAIL);
    expect(b.learner.name).toBe('Learner Bravo');
    expect(b.learner.areaCenter).toEqual([73.8077, 18.5074]);
    expect(b.learner).not.toHaveProperty('location');

    expectNoSecrets(text);
    // GET /api/requests returns the same matched view for providers.
    expectNoSecrets(await (await listRequests(req('GET', '/api/requests'), ctx())).text());
  });

  it('space giver: headcount entry before acceptance, roster name after, never contact or coordinates', async () => {
    actAs(giver);
    const res = await listMatched(req('GET', '/api/requests/matched'), ctx());
    const text = await res.clone().text();
    const { data } = await json<{ items: Matched[] }>(res);
    expect(data.items).toHaveLength(2);
    const a = data.items.find((m) => m.requestId === reqA)!;
    const b = data.items.find((m) => m.requestId === reqB)!;
    expect(a.learner.visibility).toBe('cohort');
    expect(b.learner.visibility).toBe('roster');
    expect(Object.keys(b.learner).sort()).toEqual(['name', 'requestId', 'visibility']);
    expect(b.learner.name).toBe('Learner Bravo');
    for (const s of [A_PHONE, B_PHONE, B_EMAIL, 'learner.a@contact.test']) expect(text).not.toContain(s);
    expectNoSecrets(text);
  });

  it('request detail: matched parties get the redacted view; unrelated users get 404', async () => {
    for (const u of [provider, giver]) {
      actAs(u);
      const res = await getRequest(req('GET', '/x'), ctx({ id: reqB }));
      expect(res.status).toBe(200);
      const text = await res.text();
      expectNoSecrets(text);
      expect(JSON.parse(text).data.visibility).toBe('matched');
    }
    // Cancelled enrollment: nothing disclosed.
    actAs(provider);
    expect((await getRequest(req('GET', '/x'), ctx({ id: reqC }))).status).toBe(404);
    for (const u of [otherProvider, otherGiver, learnerB]) {
      actAs(u);
      const res = await getRequest(req('GET', '/x'), ctx({ id: reqA }));
      expect(res.status).toBe(404);
      expectNoSecrets(await res.text());
    }
    for (const u of [otherProvider, otherGiver]) {
      actAs(u);
      const res = await listMatched(req('GET', '/api/requests/matched'), ctx());
      expect((await json<{ total: number }>(res.clone())).data.total).toBe(0);
    }
  });

  it('other learners never see someone else’s request; owner and admin see the exact point', async () => {
    actAs(learnerB);
    const text = await (await listRequests(req('GET', '/api/requests'), ctx())).text();
    expect(text).not.toContain('73.81234');
    expect(text).toContain('73.80456'); // their own
    actAs(learnerA);
    const own = await json<{ location: number[] }>(await getRequest(req('GET', '/x'), ctx({ id: reqA })));
    expect(own.data.location).toEqual(A_POINT);
    actAs(admin);
    const asAdmin = await json<{ location: number[] }>(await getRequest(req('GET', '/x'), ctx({ id: reqA })));
    expect(asAdmin.data.location).toEqual(A_POINT);
  });
});

describe('cross-owner writes are rejected (403)', () => {
  it('spaces, courses, offerings and requests', async () => {
    const cases: [SessionUser, () => Promise<Response>][] = [
      [otherGiver, () => patchSpace(req('PATCH', '/x', { name: 'Hijack' }), ctx({ id: spaceId }))],
      [otherGiver, () => deleteSpace(req('DELETE', '/x'), ctx({ id: spaceId }))],
      [otherProvider, () => patchCourse(req('PATCH', '/x', { title: 'Hijack' }), ctx({ id: courseId }))],
      [otherProvider, () => deleteCourse(req('DELETE', '/x'), ctx({ id: courseId }))],
      [otherProvider, () => patchOffering(req('PATCH', '/x', { batchSize: 2 }), ctx({ id: offeringId }))],
      [otherProvider, () => deleteOffering(req('DELETE', '/x'), ctx({ id: offeringId }))],
      [learnerB, () => patchRequest(req('PATCH', '/x', { notes: 'Hijack' }), ctx({ id: reqA }))],
      [learnerB, () => cancelRequest(req('POST', '/x'), ctx({ id: reqA }))],
      // Wrong role entirely.
      [provider, () => patchSpace(req('PATCH', '/x', { name: 'Hijack' }), ctx({ id: spaceId }))],
      [giver, () => patchCourse(req('PATCH', '/x', { title: 'Hijack' }), ctx({ id: courseId }))],
      [learnerA, () => patchOffering(req('PATCH', '/x', { batchSize: 2 }), ctx({ id: offeringId }))],
      [provider, () => patchRequest(req('PATCH', '/x', { notes: 'Hijack' }), ctx({ id: reqA }))],
    ];
    for (const [user, call] of cases) {
      actAs(user);
      expect((await call()).status).toBe(403);
    }
    actAs(null);
    expect((await patchSpace(req('PATCH', '/x', { name: 'Hijack' }), ctx({ id: spaceId }))).status).toBe(401);
    // Nothing changed.
    expect((await Space.findById(spaceId).lean())?.name).toBe('Dance Hall');
    expect((await Course.findById(courseId).lean())?.title).toBe('Bharatanatyam Foundations');
  });

  it('administrators can edit any owner’s records', async () => {
    actAs(admin);
    expect((await patchSpace(req('PATCH', '/x', { seatCapacity: 25 }), ctx({ id: spaceId }))).status).toBe(200);
    expect((await patchCourse(req('PATCH', '/x', { description: 'Edited by admin' }), ctx({ id: courseId }))).status).toBe(200);
    expect((await patchOffering(req('PATCH', '/x', { batchSize: 12 }), ctx({ id: offeringId }))).status).toBe(200);
    expect((await patchRequest(req('PATCH', '/x', { notes: 'Admin note' }), ctx({ id: reqA }))).status).toBe(200);
  });
});
