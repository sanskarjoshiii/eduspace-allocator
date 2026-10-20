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
import { makeArea, makeCategory, makeFacilityType, makeUser } from '../helpers/factories';
import { Allocation, Course, CourseOffering, DomainEvent, Enrollment, FacilityIssue, LearningRequest, Notification, Schedule, Space } from '@/server/models';
import { GET as issuesGET, POST as issuesPOST } from '@/app/api/facility-issues/route';
import { POST as resolvePOST } from '@/app/api/facility-issues/[id]/resolve/route';
import { POST as confirmPOST } from '@/app/api/allocations/[id]/confirm/route';
import { generateSchedules } from '@/server/services/scheduling';
import type { SessionUser } from '@/server/auth/session';
import type { FacilityIssueDto } from '@/server/dto/facility-issue';
import type { AllocationLean } from '@/server/worker/types';

beforeEach(async () => {
  await connectDb();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

async function seed() {
  const admin = await makeUser('Administrator');
  const provider = await makeUser('CourseProvider');
  const giverA = await makeUser('SpaceGiver');
  const giverB = await makeUser('SpaceGiver');
  const area = await makeArea();
  const category = await makeCategory();
  const computers = await makeFacilityType('Computers');
  const slot = [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }];
  const facilities = [{ facilityTypeId: computers._id, quantity: 20, workingQuantity: 20 }];
  const spaceA = await Space.create({ ownerUserId: giverA.id, name: 'Alpha Lab', location: { type: 'Point', coordinates: [73.81, 18.51] }, areaId: area._id, seatCapacity: 30, facilities, slots: slot });
  const spaceB = await Space.create({ ownerUserId: giverB.id, name: 'Beta Lab', location: { type: 'Point', coordinates: [73.815, 18.515] }, areaId: area._id, seatCapacity: 30, facilities, slots: slot, policy: { approvalMode: 'auto' } });

  const needs = await Course.create({ providerUserId: provider.id, title: 'Python Basics', categoryId: category._id, requirements: [{ facilityTypeId: computers._id, minQuantity: 10 }] });
  const plain = await Course.create({ providerUserId: provider.id, title: 'Spoken English', categoryId: category._id });
  const base = { providerUserId: provider.id, categoryId: category._id, batchSize: 5, sessionMinutes: 120, durationWeeks: 4, startDate: new Date(Date.now() + 7 * 86_400_000), status: 'Allocated' };
  const offX = await CourseOffering.create({ ...base, courseId: needs._id, title: 'Python Basics' });
  const offY = await CourseOffering.create({ ...base, courseId: plain._id, title: 'Spoken English' });
  const x = await Allocation.create({
    offeringId: offX._id, spaceId: spaceA._id, providerUserId: provider.id, spaceOwnerUserId: giverA.id,
    session: { dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }, score: 0.8, strategy: 'balanced', status: 'Scheduled',
    statusHistory: [{ status: 'Proposed' }, { status: 'ApprovedBySpace' }, { status: 'ConfirmedByProvider' }, { status: 'Scheduled' }],
  });
  const y = await Allocation.create({
    offeringId: offY._id, spaceId: spaceA._id, providerUserId: provider.id, spaceOwnerUserId: giverA.id,
    session: { dayOfWeek: 6, startTime: '14:00', endTime: '16:00' }, score: 0.8, strategy: 'balanced', status: 'ConfirmedByProvider',
  });
  await generateSchedules(x.toObject() as unknown as AllocationLean);

  const learner = await makeUser('Learner');
  const r = await LearningRequest.create({
    learnerUserId: learner.id, learnerProfileId: learner.ownerRefId, categoryId: category._id, areaId: area._id,
    location: { type: 'Point', coordinates: [73.808, 18.508] }, audience: 'Adults', maxDistanceKm: 5, startMonth: '2026-11',
    durationMonths: 2, consentShared: true, consentAt: new Date(), status: 'Scheduled',
  });
  const enrollment = await Enrollment.create({ requestId: r._id, learnerUserId: learner.id, offeringId: offX._id, allocationId: x._id, status: 'Accepted' });
  return { admin, provider, giverA, giverB, area, computers, spaceA, spaceB, x, y, learner, enrollment };
}

async function report(user: SessionUser, w: Awaited<ReturnType<typeof seed>>, qty = 15) {
  actAs(user);
  return json<FacilityIssueDto>(
    await issuesPOST(req('POST', '/api/facility-issues', { spaceId: w.spaceA._id.toString(), facilityTypeId: w.computers._id.toString(), affectedQuantity: qty, description: 'Power surge' }), ctx()),
  );
}

const working = async (spaceId: Types.ObjectId) => (await Space.findById(spaceId).lean())!.facilities[0]!.workingQuantity;

describe('facility issue → reallocation', () => {
  it('marks only failing allocations, proposes an alternative, and moves nothing yet', async () => {
    const w = await seed();
    const yBefore = await Allocation.findById(w.y._id).lean();
    const res = await report(w.giverA, w);
    expect(res.status).toBe(201);
    expect(await working(w.spaceA._id)).toBe(5);
    expect(res.data.affectedAllocationIds).toEqual([w.x._id.toString()]);
    expect(await DomainEvent.countDocuments({ type: 'facilityIssue.reported' })).toBe(1);

    expect((await Allocation.findById(w.x._id).lean())?.status).toBe('NeedsReallocation');
    const yAfter = await Allocation.findById(w.y._id).lean();
    expect(yAfter?.status).toBe('ConfirmedByProvider');
    expect(yAfter?.updatedAt.getTime()).toBe(yBefore!.updatedAt.getTime());

    const replacement = await Allocation.findOne({ replacesAllocationId: w.x._id }).lean();
    expect(replacement?.spaceId.toString()).toBe(w.spaceB._id.toString());
    expect(replacement?.status).toBe('ApprovedBySpace'); // Beta Lab auto-approves
    expect(replacement?.spaceOwnerUserId.toString()).toBe(w.giverB.id);
    expect(res.data.replacementAllocationIds).toEqual([replacement!._id.toString()]);

    // Nothing moved: the learner is still on the old allocation, its sessions still planned.
    expect((await Enrollment.findById(w.enrollment._id).lean())?.allocationId?.toString()).toBe(w.x._id.toString());
    expect(await Schedule.countDocuments({ allocationId: w.x._id, status: 'Planned' })).toBe(4);

    expect(await Notification.countDocuments({ type: 'facility.issueReported', userId: w.admin.id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'facility.issueReported', userId: w.learner.id })).toBe(1);
    for (const u of [w.provider, w.giverB, w.learner, w.admin]) {
      expect(await Notification.countDocuments({ type: 'reallocation.proposed', userId: u.id })).toBe(1);
    }
  });

  it('provider confirmation of the replacement moves learners and sessions', async () => {
    const w = await seed();
    await report(w.giverA, w);
    const replacement = await Allocation.findOne({ replacesAllocationId: w.x._id }).lean();
    actAs(w.provider);
    const res = await confirmPOST(req('POST', '/x', {}), ctx({ id: replacement!._id.toString() }));
    expect(res.status).toBe(200);

    expect((await Allocation.findById(w.x._id).lean())?.status).toBe('Cancelled');
    const moved = await Enrollment.findById(w.enrollment._id).lean();
    expect(moved?.allocationId?.toString()).toBe(replacement!._id.toString());
    expect(moved?.status).toBe('Accepted');
    expect(await Schedule.countDocuments({ allocationId: w.x._id, status: 'Moved' })).toBe(4);
    expect(await Schedule.countDocuments({ allocationId: replacement!._id, status: 'Planned' })).toBe(4);
    expect((await Allocation.findById(replacement!._id).lean())?.status).toBe('Scheduled');
    expect(await Notification.countDocuments({ type: 'schedule.changed', userId: w.learner.id })).toBe(1);
  });

  it('resolving restores the working quantity and the original allocation; the replacement is withdrawn', async () => {
    const w = await seed();
    const issue = await report(w.giverA, w);
    actAs(w.giverA);
    const res = await json<FacilityIssueDto>(await resolvePOST(req('POST', '/x', {}), ctx({ id: issue.data.id })));
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('Resolved');
    expect(await working(w.spaceA._id)).toBe(20);
    expect((await Allocation.findById(w.x._id).lean())?.status).toBe('Scheduled');
    const replacement = await Allocation.findOne({ replacesAllocationId: w.x._id }).lean();
    expect(['Superseded', 'Cancelled']).toContain(replacement?.status);
    expect((await resolvePOST(req('POST', '/x', {}), ctx({ id: issue.data.id }))).status).toBe(409);
  });

  it('only the owning space giver (or an admin) can report, and lists are scoped', async () => {
    const w = await seed();
    expect((await report(w.giverB, w)).status).toBe(403);
    actAs(w.learner);
    expect((await issuesPOST(req('POST', '/api/facility-issues', {}), ctx())).status).toBe(403);
    await report(w.admin, w, 1);
    expect(await FacilityIssue.countDocuments()).toBe(1);
    expect(await working(w.spaceA._id)).toBe(19);

    actAs(w.giverA);
    expect((await json<FacilityIssueDto[]>(await issuesGET(req('GET', '/api/facility-issues'), ctx()))).data).toHaveLength(1);
    actAs(w.giverB);
    expect((await json<FacilityIssueDto[]>(await issuesGET(req('GET', '/api/facility-issues'), ctx()))).data).toHaveLength(0);
    actAs(w.provider);
    expect((await json<FacilityIssueDto[]>(await issuesGET(req('GET', '/api/facility-issues'), ctx()))).data).toHaveLength(1);
  });

  it('working quantity never goes below zero', async () => {
    const w = await seed();
    await report(w.giverA, w, 500);
    expect(await working(w.spaceA._id)).toBe(0);
  });
});
