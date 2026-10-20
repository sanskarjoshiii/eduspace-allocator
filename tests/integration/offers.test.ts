import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
vi.mock('@/server/services/alerts', () => ({ evaluateDemandAlerts: vi.fn(async () => ({ fired: 0 })) }));
vi.mock('@/server/services/engine-client', async () => {
  const { referenceEngine } = await import('@/server/worker/reference-engine');
  return { getEngine: () => referenceEngine };
});

import mongoose, { Types } from 'mongoose';
import { connectDb } from '@/lib/db';
import { ENROLLMENT_TRANSITIONS, canTransition, type AllocationStatus, type EnrollmentStatus } from '@/lib/domain';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeCategory, makeUser } from '../helpers/factories';
import { Allocation, Course, CourseOffering, Enrollment, LearningRequest, Notification, Space } from '@/server/models';
import { POST as acceptPOST } from '@/app/api/enrollments/[id]/accept/route';
import { POST as declinePOST } from '@/app/api/enrollments/[id]/decline/route';
import { GET as minePGET } from '@/app/api/enrollments/mine/route';
import { POST as confirmPOST } from '@/app/api/allocations/[id]/confirm/route';
import { promoteWaitlist, releaseEnrollmentsForRequest, runOfferJobs } from '@/server/services/enrollments';
import { setEnrollmentStatus } from '@/server/worker/lifecycle';
import { HttpError } from '@/server/http';
import type { SessionUser } from '@/server/auth/session';
import type { MyEnrollmentDto } from '@/server/dto/enrollment';

beforeEach(async () => {
  await connectDb();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

const SEAT_HOLDING = ['Proposed', 'Offered', 'Accepted'];
const seats = (allocationId: Types.ObjectId) => Enrollment.countDocuments({ allocationId, status: { $in: SEAT_HOLDING } });

/** A class with `seated` learners holding seats and `waiting` on the waitlist. */
async function seedClass(opts: { status?: AllocationStatus; batchSize?: number; seated?: number; waiting?: number; seatStatus?: EnrollmentStatus } = {}) {
  const status = opts.status ?? 'ConfirmedByProvider';
  const provider = await makeUser('CourseProvider');
  const giver = await makeUser('SpaceGiver');
  const area = await makeArea();
  const category = await makeCategory();
  const space = await Space.create({
    ownerUserId: giver.id, name: 'Sunrise Hall', location: { type: 'Point', coordinates: [73.81, 18.51] }, areaId: area._id, seatCapacity: 30,
    slots: [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }],
  });
  const course = await Course.create({ providerUserId: provider.id, title: 'Python Basics', categoryId: category._id });
  const offering = await CourseOffering.create({
    courseId: course._id, providerUserId: provider.id, title: 'Python Basics', categoryId: category._id, batchSize: opts.batchSize ?? 2,
    sessionMinutes: 120, durationWeeks: 4, startDate: new Date(Date.now() + 7 * 86_400_000), status: 'Allocated',
  });
  const alloc = await Allocation.create({
    offeringId: offering._id, spaceId: space._id, providerUserId: provider.id, spaceOwnerUserId: giver.id,
    session: { dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }, score: 0.8, distanceKm: 1.2, strategy: 'balanced', status,
  });
  const learners: { user: SessionUser; requestId: Types.ObjectId; enrollmentId: Types.ObjectId }[] = [];
  const seatStatus: EnrollmentStatus = opts.seatStatus ?? (status === 'ConfirmedByProvider' || status === 'Scheduled' ? 'Offered' : 'Proposed');
  const total = (opts.seated ?? 2) + (opts.waiting ?? 0);
  for (let i = 0; i < total; i++) {
    const user = await makeUser('Learner');
    const waiting = i >= (opts.seated ?? 2);
    const st: EnrollmentStatus = waiting ? 'Waitlisted' : seatStatus;
    const r = await LearningRequest.create({
      learnerUserId: user.id, learnerProfileId: user.ownerRefId, categoryId: category._id, areaId: area._id,
      location: { type: 'Point', coordinates: [73.808, 18.508] }, audience: 'Adults', maxDistanceKm: 5, startMonth: '2026-11',
      durationMonths: 2, consentShared: true, consentAt: new Date(),
      status: waiting ? 'Waitlisted' : st === 'Offered' ? 'Offered' : 'Matched',
    });
    const e = await Enrollment.create({
      requestId: r._id, learnerUserId: user.id, offeringId: offering._id, allocationId: alloc._id, status: st, distanceKm: 1.1, score: 0.8,
      waitlistRank: waiting ? i - (opts.seated ?? 2) + 1 : null,
      offerExpiresAt: st === 'Offered' ? new Date(Date.now() + 48 * 3_600_000) : null,
    });
    learners.push({ user, requestId: r._id, enrollmentId: e._id });
  }
  return { provider, giver, space, offering, alloc, learners };
}

describe('accept and decline', () => {
  it('accept moves the enrollment and request on and tells the provider', async () => {
    const c = await seedClass({ seated: 2 });
    const l = c.learners[0]!;
    actAs(l.user);
    const res = await json<{ status: string }>(await acceptPOST(req('POST', '/x'), ctx({ id: l.enrollmentId.toString() })));
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('Accepted');
    // First acceptance on a confirmed class schedules it, so the request lands on Scheduled.
    expect((await LearningRequest.findById(l.requestId).lean())?.status).toBe('Scheduled');
    expect(await Notification.countDocuments({ type: 'offer.accepted', userId: c.provider.id })).toBe(1);
  });

  it('only the owning learner may accept, and only an Offered enrollment', async () => {
    const c = await seedClass({ seated: 2 });
    actAs(c.learners[1]!.user);
    expect((await acceptPOST(req('POST', '/x'), ctx({ id: c.learners[0]!.enrollmentId.toString() }))).status).toBe(403);
    actAs(c.provider);
    expect((await acceptPOST(req('POST', '/x'), ctx({ id: c.learners[0]!.enrollmentId.toString() }))).status).toBe(403);
    actAs(c.learners[0]!.user);
    await acceptPOST(req('POST', '/x'), ctx({ id: c.learners[0]!.enrollmentId.toString() }));
    const again = await json(await acceptPOST(req('POST', '/x'), ctx({ id: c.learners[0]!.enrollmentId.toString() })));
    expect(again.status).toBe(409);
  });

  it('an expired offer cannot be accepted; the seat goes to the waitlist', async () => {
    const c = await seedClass({ seated: 2, waiting: 1 });
    const l = c.learners[0]!;
    await Enrollment.updateOne({ _id: l.enrollmentId }, { $set: { offerExpiresAt: new Date(Date.now() - 60_000) } });
    actAs(l.user);
    const res = await json(await acceptPOST(req('POST', '/x'), ctx({ id: l.enrollmentId.toString() })));
    expect(res.status).toBe(410);
    expect(res.error?.message).toBe('This offer expired.');
    expect((await Enrollment.findById(l.enrollmentId).lean())?.status).toBe('Expired');
    expect((await Enrollment.findById(c.learners[2]!.enrollmentId).lean())?.status).toBe('Offered');
    expect(await seats(c.alloc._id)).toBe(2);
  });

  it('decline promotes the next waitlisted learner and preserves the seat count exactly', async () => {
    const c = await seedClass({ batchSize: 2, seated: 2, waiting: 2 });
    expect(await seats(c.alloc._id)).toBe(2);
    actAs(c.learners[0]!.user);
    const res = await json<{ status: string; requestStatus: string }>(await declinePOST(req('POST', '/x'), ctx({ id: c.learners[0]!.enrollmentId.toString() })));
    expect(res.data).toMatchObject({ status: 'Declined', requestStatus: 'Declined' });
    expect(await Notification.countDocuments({ type: 'offer.declined', userId: c.provider.id })).toBe(1);

    const promoted = await Enrollment.findById(c.learners[2]!.enrollmentId).lean();
    expect(promoted?.status).toBe('Offered');
    expect(promoted?.offerExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect((await LearningRequest.findById(c.learners[2]!.requestId).lean())?.status).toBe('Offered');
    expect(await Notification.countDocuments({ type: 'waitlist.promoted', userId: c.learners[2]!.user.id })).toBe(1);
    expect(await seats(c.alloc._id)).toBe(2);
    // The remaining waitlist moves up to rank 1.
    expect((await Enrollment.findById(c.learners[3]!.enrollmentId).lean())?.waitlistRank).toBe(1);
  });

  it('promotion on a class not yet confirmed holds the seat as Proposed, without an offer', async () => {
    const c = await seedClass({ status: 'ApprovedBySpace', batchSize: 2, seated: 1, waiting: 2 });
    const promoted = await promoteWaitlist(c.alloc._id, null);
    expect(promoted).toHaveLength(1);
    expect((await Enrollment.findById(c.learners[1]!.enrollmentId).lean())?.status).toBe('Proposed');
    expect((await Enrollment.findById(c.learners[2]!.enrollmentId).lean())?.status).toBe('Waitlisted');
    expect(await seats(c.alloc._id)).toBe(2);
    expect(await Notification.countDocuments({ type: 'waitlist.promoted' })).toBe(0);
  });

  it('promotion never exceeds the batch size even when called concurrently', async () => {
    const c = await seedClass({ batchSize: 3, seated: 1, waiting: 5 });
    await Promise.all([promoteWaitlist(c.alloc._id, null), promoteWaitlist(c.alloc._id, null)]);
    expect(await seats(c.alloc._id)).toBeLessThanOrEqual(3);
  });
});

describe('expiry job', () => {
  it('expires overdue offers with promotion and sends one expiring reminder', async () => {
    const c = await seedClass({ batchSize: 2, seated: 2, waiting: 1 });
    await Enrollment.updateOne({ _id: c.learners[0]!.enrollmentId }, { $set: { offerExpiresAt: new Date(Date.now() - 1000) } });
    await Enrollment.updateOne({ _id: c.learners[1]!.enrollmentId }, { $set: { offerExpiresAt: new Date(Date.now() + 2 * 3_600_000) } });
    const first = await runOfferJobs();
    expect(first.expired).toBe(1);
    expect((await Enrollment.findById(c.learners[0]!.enrollmentId).lean())?.status).toBe('Expired');
    expect((await LearningRequest.findById(c.learners[0]!.requestId).lean())?.status).toBe('Expired');
    expect(await Notification.countDocuments({ type: 'offer.expired', userId: c.learners[0]!.user.id })).toBe(1);
    expect((await Enrollment.findById(c.learners[2]!.enrollmentId).lean())?.status).toBe('Offered');
    expect(await seats(c.alloc._id)).toBe(2);
    expect(await Notification.countDocuments({ type: 'offer.expiring', userId: c.learners[1]!.user.id })).toBe(1);

    const second = await runOfferJobs();
    expect(second.expired).toBe(0);
    expect(await Notification.countDocuments({ type: 'offer.expiring', userId: c.learners[1]!.user.id })).toBe(1);
  });
});

describe('enrollment state machine', () => {
  it('rejects illegal transitions', async () => {
    const c = await seedClass({ seated: 1 });
    const id = c.learners[0]!.enrollmentId;
    await setEnrollmentStatus(id, 'Declined');
    await expect(setEnrollmentStatus(id, 'Accepted')).rejects.toBeInstanceOf(HttpError);
    await expect(setEnrollmentStatus(id, 'Offered')).rejects.toMatchObject({ status: 409 });
    expect(canTransition(ENROLLMENT_TRANSITIONS, 'Accepted', 'Offered')).toBe(false);
    expect(canTransition(ENROLLMENT_TRANSITIONS, 'Expired', 'Accepted')).toBe(false);
    expect(canTransition(ENROLLMENT_TRANSITIONS, 'Waitlisted', 'Accepted')).toBe(false);
    expect(canTransition(ENROLLMENT_TRANSITIONS, 'Offered', 'Accepted')).toBe(true);
  });
});

describe('confirmation sends offers', () => {
  it('confirm turns held seats into offers with expiry and tells the learners', async () => {
    const c = await seedClass({ status: 'ApprovedBySpace', seated: 2 });
    actAs(c.provider);
    const res = await confirmPOST(req('POST', '/x', {}), ctx({ id: c.alloc._id.toString() }));
    expect(res.status).toBe(200);
    const es = await Enrollment.find({ allocationId: c.alloc._id }).lean();
    expect(es.every((e) => e.status === 'Offered' && e.offerExpiresAt)).toBe(true);
    expect(await Notification.countDocuments({ type: 'offer.sent' })).toBe(2);
    expect(await Notification.countDocuments({ type: 'allocation.confirmed', userId: c.giver.id })).toBe(1);
    expect((await LearningRequest.find({ _id: { $in: c.learners.map((l) => l.requestId) } }).lean()).every((r) => r.status === 'Offered')).toBe(true);
  });
});

describe('release and listing', () => {
  it('releasing a request cancels its enrollment and promotes the waitlist', async () => {
    const c = await seedClass({ batchSize: 1, seated: 1, waiting: 1 });
    await releaseEnrollmentsForRequest(c.learners[0]!.requestId.toString(), null);
    expect((await Enrollment.findById(c.learners[0]!.enrollmentId).lean())?.status).toBe('Cancelled');
    expect((await Enrollment.findById(c.learners[1]!.enrollmentId).lean())?.status).toBe('Offered');
    expect(await seats(c.alloc._id)).toBe(1);
  });

  it('GET /api/enrollments/mine returns only the learner’s own offers', async () => {
    const c = await seedClass({ seated: 2 });
    actAs(c.learners[0]!.user);
    const res = await json<MyEnrollmentDto[]>(await minePGET(req('GET', '/api/enrollments/mine'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ status: 'Offered', courseTitle: 'Python Basics', spaceName: 'Sunrise Hall', sessionLabel: 'Sat 10:00–12:00' });
    expect(res.data[0]!.offerExpiresAt).toBeTruthy();
    actAs(c.provider);
    expect((await minePGET(req('GET', '/api/enrollments/mine'), ctx())).status).toBe(403);
  });
});
