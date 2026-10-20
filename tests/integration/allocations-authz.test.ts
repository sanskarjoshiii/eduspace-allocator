import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
vi.mock('@/server/services/alerts', () => ({ evaluateDemandAlerts: vi.fn(async () => ({ fired: 0 })) }));
vi.mock('@/server/services/engine-client', async () => {
  const { referenceEngine } = await import('@/server/worker/reference-engine');
  return { getEngine: () => referenceEngine };
});

import mongoose, { Types } from 'mongoose';
import { connectDb } from '@/lib/db';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import { Allocation, AuditLog, Course, CourseOffering, DomainEvent, Enrollment, LearningRequest, Notification, Space } from '@/server/models';
import { GET as listGET } from '@/app/api/allocations/route';
import { GET as detailGET } from '@/app/api/allocations/[id]/route';
import { POST as approvePOST } from '@/app/api/allocations/[id]/approve/route';
import { POST as rejectPOST } from '@/app/api/allocations/[id]/reject/route';
import { POST as confirmPOST } from '@/app/api/allocations/[id]/confirm/route';
import { POST as overridePOST } from '@/app/api/allocations/[id]/override/route';
import { GET as rosterGET } from '@/app/api/enrollments/route';
import { POST as acceptPOST } from '@/app/api/enrollments/[id]/accept/route';
import type { SessionUser } from '@/server/auth/session';
import type { AllocationDetailDto, AllocationListItemDto, LearnerAllocationDto } from '@/server/dto/allocation';
import type { RosterDto } from '@/server/dto/enrollment';

beforeEach(async () => {
  await connectDb();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

async function seed() {
  const admin = await makeUser('Administrator');
  const p1 = await makeUser('CourseProvider');
  const p2 = await makeUser('CourseProvider');
  const g1 = await makeUser('SpaceGiver');
  const g2 = await makeUser('SpaceGiver');
  const area = await makeArea();
  const category = await makeCategory();
  const slots = [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }];
  const s1 = await Space.create({ ownerUserId: g1.id, name: 'Manual Hall', location: { type: 'Point', coordinates: [73.81, 18.51] }, areaId: area._id, seatCapacity: 30, slots, policy: { approvalMode: 'manual' } });
  const s2 = await Space.create({ ownerUserId: g2.id, name: 'Other Hall', location: { type: 'Point', coordinates: [73.811, 18.511] }, areaId: area._id, seatCapacity: 30, slots });
  const mk = async (p: SessionUser, title: string) => {
    const course = await Course.create({ providerUserId: p.id, title, categoryId: category._id });
    return CourseOffering.create({
      courseId: course._id, providerUserId: p.id, title, categoryId: category._id, batchSize: 1, sessionMinutes: 120, durationWeeks: 4,
      startDate: new Date(Date.now() + 7 * 86_400_000), status: 'Allocated',
    });
  };
  const o1 = await mk(p1, 'Python Basics');
  const o2 = await mk(p2, 'Spoken English');
  const a1 = await Allocation.create({
    offeringId: o1._id, spaceId: s1._id, providerUserId: p1.id, spaceOwnerUserId: g1.id, session: { dayOfWeek: 6, startTime: '10:00', endTime: '12:00' },
    score: 0.81, strategy: 'balanced', status: 'Proposed', statusHistory: [{ status: 'Proposed' }],
  });
  const a2 = await Allocation.create({
    offeringId: o2._id, spaceId: s2._id, providerUserId: p2.id, spaceOwnerUserId: g2.id, session: { dayOfWeek: 6, startTime: '10:00', endTime: '12:00' },
    score: 0.7, strategy: 'balanced', status: 'Proposed',
  });
  const learner = async (status: 'Proposed' | 'Waitlisted') => {
    const user = await makeUser('Learner');
    const r = await LearningRequest.create({
      learnerUserId: user.id, learnerProfileId: user.ownerRefId, categoryId: category._id, areaId: area._id,
      location: { type: 'Point', coordinates: [73.808123, 18.508456] }, audience: 'Adults', maxDistanceKm: 5, startMonth: '2026-11',
      durationMonths: 2, consentShared: true, consentAt: new Date(), status: status === 'Proposed' ? 'Matched' : 'Waitlisted',
    });
    const e = await Enrollment.create({ requestId: r._id, learnerUserId: user.id, offeringId: o1._id, allocationId: a1._id, status, waitlistRank: status === 'Waitlisted' ? 1 : null });
    return { user, requestId: r._id, enrollmentId: e._id };
  };
  const l1 = await learner('Proposed');
  const l2 = await learner('Waitlisted');
  return { admin, p1, p2, g1, g2, s1, s2, o1, o2, a1, a2, l1, l2 };
}

const id = (x: { _id: Types.ObjectId }) => ({ id: x._id.toString() });
type Page<T> = { items: T[]; meta: { total: number } };

describe('GET /api/allocations role scoping', () => {
  it('admin sees all, space givers and providers their own, learners only where they hold a place', async () => {
    const w = await seed();
    actAs(w.admin);
    expect((await json<Page<AllocationListItemDto>>(await listGET(req('GET', '/api/allocations'), ctx()))).data.meta.total).toBe(2);
    expect((await json<Page<AllocationListItemDto>>(await listGET(req('GET', `/api/allocations?spaceId=${w.s2._id.toString()}`), ctx()))).data.meta.total).toBe(1);
    actAs(w.g1);
    const g1 = await json<Page<AllocationListItemDto>>(await listGET(req('GET', '/api/allocations'), ctx()));
    expect(g1.data.items.map((i) => i.id)).toEqual([w.a1._id.toString()]);
    expect(g1.data.items[0]!.seats).toMatchObject({ batchSize: 1, proposed: 1, waitlisted: 1, taken: 1 });
    actAs(w.p2);
    expect((await json<Page<AllocationListItemDto>>(await listGET(req('GET', '/api/allocations'), ctx()))).data.items.map((i) => i.id)).toEqual([w.a2._id.toString()]);
    actAs(w.l1.user);
    const l = await json<Page<LearnerAllocationDto>>(await listGET(req('GET', '/api/allocations'), ctx()));
    expect(l.data.items).toHaveLength(1);
    expect(l.data.items[0]!.myEnrollment?.status).toBe('Proposed');
    expect(l.data.items[0]).not.toHaveProperty('seats');
  });

  it('detail hides other people’s allocations and redacts the cohort by stage', async () => {
    const w = await seed();
    actAs(w.p2);
    expect((await detailGET(req('GET', '/x'), ctx(id(w.a1)))).status).toBe(404);
    actAs(await makeUser('Learner'));
    expect((await detailGET(req('GET', '/x'), ctx(id(w.a1)))).status).toBe(404);
    actAs(w.l1.user);
    const mine = await json<LearnerAllocationDto>(await detailGET(req('GET', '/x'), ctx(id(w.a1))));
    expect(mine.data.myEnrollment?.id).toBe(w.l1.enrollmentId.toString());
    expect(mine.data).not.toHaveProperty('cohort');

    actAs(w.p1);
    const d = await json<AllocationDetailDto>(await detailGET(req('GET', '/x'), ctx(id(w.a1))));
    expect(d.data.cohort?.headcount).toBe(1);
    expect(d.data.cohort?.learners.every((v) => v.visibility === 'cohort')).toBe(true);
    expect(JSON.stringify(d.data)).not.toContain('18.508456');
    expect(d.data.actions).toMatchObject({ confirm: false, approve: false, override: false });
    actAs(w.g1);
    expect((await json<AllocationDetailDto>(await detailGET(req('GET', '/x'), ctx(id(w.a1))))).data.actions.approve).toBe(true);
  });
});

describe('approve, confirm, reject', () => {
  it('manual mode blocks confirmation until the owning space giver approves; only the owning provider confirms', async () => {
    const w = await seed();
    actAs(w.p1);
    const early = await json(await confirmPOST(req('POST', '/x', {}), ctx(id(w.a1))));
    expect(early.status).toBe(409);
    expect(early.error?.message).toBe('The space has not approved this yet.');

    actAs(w.g2);
    expect((await approvePOST(req('POST', '/x', {}), ctx(id(w.a1)))).status).toBe(403);
    actAs(w.p1);
    expect((await approvePOST(req('POST', '/x', {}), ctx(id(w.a1)))).status).toBe(403);
    actAs(w.g1);
    const ok = await json<AllocationDetailDto>(await approvePOST(req('POST', '/x', { note: 'Looks good' }), ctx(id(w.a1))));
    expect(ok.data.status).toBe('ApprovedBySpace');
    expect(ok.data.statusHistory.at(-1)?.note).toBe('Looks good');
    expect(await Notification.countDocuments({ type: 'allocation.approved', userId: w.p1.id })).toBe(1);
    expect((await approvePOST(req('POST', '/x', {}), ctx(id(w.a1)))).status).toBe(409);

    actAs(w.p2);
    expect((await confirmPOST(req('POST', '/x', {}), ctx(id(w.a1)))).status).toBe(403);
    actAs(w.p1);
    const conf = await json<AllocationDetailDto>(await confirmPOST(req('POST', '/x', {}), ctx(id(w.a1))));
    expect(conf.data.status).toBe('ConfirmedByProvider');
    expect(await AuditLog.countDocuments({ entity: 'Allocation', action: 'confirm' })).toBe(1);
  });

  it('reject sends the offering back to the engine and tells the provider', async () => {
    const w = await seed();
    actAs(w.g1);
    const res = await json<AllocationDetailDto>(await rejectPOST(req('POST', '/x', { note: 'Room booked for exams' }), ctx(id(w.a1))));
    expect(res.data.status).toBe('Rejected');
    expect(await Enrollment.countDocuments({ allocationId: w.a1._id, status: 'Cancelled' })).toBe(2);
    expect((await LearningRequest.findById(w.l1.requestId).lean())?.status).toBe('Analysed');
    expect((await CourseOffering.findById(w.o1._id).lean())?.status).toBe('Open');
    expect(await DomainEvent.countDocuments({ type: 'offering.saved', refId: w.o1._id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'allocation.rejected', userId: w.p1.id })).toBe(1);
  });
});

describe('override', () => {
  it('is Administrator only and audited with the note', async () => {
    const w = await seed();
    actAs(w.p1);
    expect((await overridePOST(req('POST', '/x', { action: 'confirm', note: 'please' }), ctx(id(w.a1)))).status).toBe(403);
    actAs(w.admin);
    expect((await overridePOST(req('POST', '/x', { action: 'confirm' }), ctx(id(w.a1)))).status).toBe(422);
    const res = await json<AllocationDetailDto>(await overridePOST(req('POST', '/x', { action: 'confirm', note: 'Agreed by phone' }), ctx(id(w.a1))));
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ConfirmedByProvider');
    expect(res.data.overrideNote).toBe('Agreed by phone');
    const entry = await AuditLog.findOne({ action: 'override', entity: 'Allocation', entityId: w.a1._id }).lean();
    expect(entry?.actorId?.toString()).toBe(w.admin.id);
    expect(JSON.stringify(entry?.diff)).toContain('Agreed by phone');
  });

  it('move re-checks the target and rejects clashes', async () => {
    const w = await seed();
    await Allocation.updateOne({ _id: w.a2._id }, { $set: { spaceId: w.s1._id, spaceOwnerUserId: w.g1.id, status: 'ConfirmedByProvider', session: { dayOfWeek: 6, startTime: '13:00', endTime: '15:00' } } });
    actAs(w.admin);
    const clash = await json(await overridePOST(req('POST', '/x', { action: 'move', note: 'try later slot', session: { dayOfWeek: 6, startTime: '14:00', endTime: '16:00' } }), ctx(id(w.a1))));
    expect(clash.status).toBe(409);
    const outside = await json(await overridePOST(req('POST', '/x', { action: 'move', note: 'evening', session: { dayOfWeek: 6, startTime: '18:00', endTime: '20:00' } }), ctx(id(w.a1))));
    expect(outside.status).toBe(409); // outside the space's open slot
    const ok = await json<AllocationDetailDto>(
      await overridePOST(req('POST', '/x', { action: 'move', note: 'other hall', spaceId: w.s2._id.toString() }), ctx(id(w.a1))),
    );
    expect(ok.status).toBe(200);
    expect(ok.data.space.id).toBe(w.s2._id.toString());
    expect((await Allocation.findById(w.a1._id).lean())?.spaceOwnerUserId.toString()).toBe(w.g2.id);
    expect(await AuditLog.countDocuments({ action: 'override', entityId: w.a1._id })).toBeGreaterThanOrEqual(2);
  });
});

describe('roster redaction', () => {
  it('provider sees contact only for accepted learners; space giver a name only; others nothing', async () => {
    const w = await seed();
    await Allocation.updateOne({ _id: w.a1._id }, { $set: { status: 'ApprovedBySpace' } });
    actAs(w.p1);
    await confirmPOST(req('POST', '/x', {}), ctx(id(w.a1)));
    actAs(w.l1.user);
    expect((await acceptPOST(req('POST', '/x'), ctx({ id: w.l1.enrollmentId.toString() }))).status).toBe(200);

    const url = `/api/enrollments?allocationId=${w.a1._id.toString()}`;
    actAs(w.p1);
    const p = await json<RosterDto>(await rosterGET(req('GET', url), ctx()));
    const accepted = p.data.entries.find((e) => e.status === 'Accepted');
    const waiting = p.data.entries.find((e) => e.status === 'Waitlisted');
    expect(accepted?.learner).toMatchObject({ visibility: 'provider-accepted', contactEmail: expect.stringContaining('@') });
    expect(waiting?.learner?.visibility).toBe('cohort');
    expect(waiting?.learner).not.toHaveProperty('name');
    expect(JSON.stringify(p.data)).not.toContain('18.508456');

    actAs(w.g1);
    const g = await json<RosterDto>(await rosterGET(req('GET', url), ctx()));
    const gAccepted = g.data.entries.find((e) => e.status === 'Accepted');
    expect(gAccepted?.learner).toEqual({ visibility: 'roster', requestId: w.l1.requestId.toString(), name: expect.any(String) });
    expect(JSON.stringify(g.data)).not.toContain('contact');

    actAs(w.admin);
    const a = await json<RosterDto>(await rosterGET(req('GET', url), ctx()));
    expect(a.data.entries.every((e) => e.learner?.visibility === 'full')).toBe(true);

    actAs(w.p2);
    expect((await rosterGET(req('GET', url), ctx())).status).toBe(403);
    actAs(w.l1.user);
    expect((await rosterGET(req('GET', url), ctx())).status).toBe(403);
  });
});
