import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
const state = vi.hoisted(() => ({ real: false, throwOnce: false }));
const alerts = vi.hoisted(() => ({ evaluateDemandAlerts: vi.fn(async () => ({ fired: 0 })) }));
const impact = vi.hoisted(() => ({ computeImpactSnapshot: vi.fn(async () => undefined) }));
vi.mock('@/server/services/alerts', () => alerts);
vi.mock('@/server/services/impact', () => impact);
// Most tests use the deterministic reference engine (exact seat / waitlist outcomes);
// one test runs the real Smart Allocation engine from src/engine.
vi.mock('@/server/services/engine-client', async () => {
  const { referenceEngine } = await import('@/server/worker/reference-engine');
  const { engine } = await import('@/engine');
  return {
    getEngine: () => {
      if (state.throwOnce) {
        state.throwOnce = false;
        return { ...referenceEngine, runPipeline: () => { throw new Error('engine exploded'); } };
      }
      return state.real ? engine : referenceEngine;
    },
  };
});

import mongoose, { Types } from 'mongoose';
import { connectDb } from '@/lib/db';
import { makeArea, makeCategory, makeFacilityType, makeUser } from '../helpers/factories';
import {
  Allocation,
  AllocationRun,
  AuditLog,
  Course,
  CourseOffering,
  DomainEvent,
  Enrollment,
  LearningRequest,
  Notification,
  Space,
} from '@/server/models';
import { emitEvent } from '@/server/services/events';
import { updateSettings } from '@/server/services/settings';
import { executeRun, tick } from '@/server/worker/run';
import { runNightly } from '@/server/worker/nightly';
import { publishRun } from '@/server/worker/publish';
import { buildSnapshotWithContext } from '@/server/worker/snapshot';
import { referenceEngine } from '@/server/worker/reference-engine';
import type { SessionUser } from '@/server/auth/session';

async function clearDb() {
  await connectDb();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
}

const nextWeek = () => new Date(Date.now() + 7 * 86_400_000);

async function seedWorld(opts: { approvalMode?: 'auto' | 'manual'; batchSize?: number; learners?: number } = {}) {
  const admin = await makeUser('Administrator');
  const provider = await makeUser('CourseProvider');
  const giver = await makeUser('SpaceGiver');
  const area = await makeArea({ lng: 73.8077, lat: 18.5074 });
  const category = await makeCategory();
  const computers = await makeFacilityType();
  const space = await Space.create({
    ownerUserId: giver.id, name: 'Sunrise Hall', location: { type: 'Point', coordinates: [73.81, 18.51] }, areaId: area._id, seatCapacity: 30,
    facilities: [{ facilityTypeId: computers._id, quantity: 20, workingQuantity: 20 }],
    slots: [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }], policy: { approvalMode: opts.approvalMode ?? 'auto' },
  });
  const course = await Course.create({ providerUserId: provider.id, title: 'Python Basics', categoryId: category._id, requirements: [{ facilityTypeId: computers._id, minQuantity: 10 }] });
  const offering = await CourseOffering.create({
    courseId: course._id, providerUserId: provider.id, title: 'Python Basics', categoryId: category._id, batchSize: opts.batchSize ?? 2,
    sessionMinutes: 120, durationWeeks: 4, startDate: nextWeek(), windows: [{ dayOfWeek: 6, startTime: '10:00', endTime: '13:00' }], targetAreaId: area._id,
  });
  const learners: SessionUser[] = [];
  const requests: Types.ObjectId[] = [];
  for (let i = 0; i < (opts.learners ?? 3); i++) {
    const l = await makeUser('Learner', { areaId: area._id.toString() });
    learners.push(l);
    const r = await LearningRequest.create({
      learnerUserId: l.id, learnerProfileId: l.ownerRefId, categoryId: category._id, areaId: area._id,
      location: { type: 'Point', coordinates: [73.808 + i * 0.001, 18.508] }, audience: 'Adults', maxDistanceKm: 5,
      startMonth: '2026-11', durationMonths: 2, consentShared: true, consentAt: new Date(),
    });
    requests.push(r._id);
    await emitEvent('request.saved', r._id);
  }
  return { admin, provider, giver, area, category, computers, space, course, offering, learners, requests };
}

beforeEach(async () => {
  await clearDb();
  state.real = false;
  state.throwOnce = false;
  alerts.evaluateDemandAlerts.mockClear();
});

describe('event → tick → run → publish → notify', () => {
  it('publishes allocations, enrollments, request statuses and notifications in one run', async () => {
    const w = await seedWorld({ approvalMode: 'auto', batchSize: 2, learners: 3 });
    await updateSettings({ debounceSeconds: 0 }, null);
    const res = await tick();
    expect(res.action).toBe('ran');

    const run = await AllocationRun.findOne().lean();
    expect(run?.status).toBe('Completed');
    expect(run?.partitionState?.completedPhases).toEqual(expect.arrayContaining(['snapshot', 'engine', 'publish', 'notify', 'done']));
    expect(run?.decisionSummary).toMatch(/2 learners seated, 1 waitlisted/);

    const allocs = await Allocation.find().lean();
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.status).toBe('ApprovedBySpace'); // auto mode
    expect(allocs[0]!.statusHistory.map((h) => h.note)).toContain('Auto-approved under space policy');
    expect(allocs[0]!.providerUserId.toString()).toBe(w.provider.id);
    expect(allocs[0]!.spaceOwnerUserId.toString()).toBe(w.giver.id);

    const enrollments = await Enrollment.find().lean();
    expect(enrollments.filter((e) => e.status === 'Proposed')).toHaveLength(2);
    const wait = enrollments.filter((e) => e.status === 'Waitlisted');
    expect(wait).toHaveLength(1);
    expect(wait[0]!.waitlistRank).toBe(1);

    const statuses = (await LearningRequest.find().lean()).map((r) => r.status).sort();
    expect(statuses).toEqual(['Matched', 'Matched', 'Waitlisted']);
    expect(await CourseOffering.findById(w.offering._id).lean()).toMatchObject({ status: 'Allocated' });

    expect(await DomainEvent.countDocuments({ processedAt: null })).toBe(0);
    expect(await Notification.countDocuments({ type: 'allocation.approved' })).toBe(2);
    expect(await AuditLog.countDocuments({ action: 'engine', entity: 'AllocationRun' })).toBe(1);
    expect(alerts.evaluateDemandAlerts).toHaveBeenCalled();
  });

  it('manual approval mode asks the space giver and tells the provider it is proposed', async () => {
    const w = await seedWorld({ approvalMode: 'manual' });
    await executeRun({ trigger: 'manual' });
    const alloc = await Allocation.findOne().lean();
    expect(alloc?.status).toBe('Proposed');
    expect(await Notification.countDocuments({ type: 'allocation.approvalNeeded', userId: w.giver.id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'allocation.proposed', userId: w.provider.id })).toBe(1);
  });

  it('marks unmatched learners and tells them', async () => {
    const w = await seedWorld({ learners: 1 });
    const other = await makeCategory();
    const l = await makeUser('Learner');
    await LearningRequest.create({
      learnerUserId: l.id, learnerProfileId: l.ownerRefId, categoryId: other._id, areaId: w.area._id,
      location: { type: 'Point', coordinates: [73.808, 18.508] }, audience: 'Adults', maxDistanceKm: 5,
      startMonth: '2026-11', durationMonths: 2, consentShared: true, consentAt: new Date(),
    });
    await executeRun({ trigger: 'manual' });
    expect((await LearningRequest.findOne({ learnerUserId: l.id }).lean())?.status).toBe('Unmatched');
    expect(await Notification.countDocuments({ type: 'request.unmatched', userId: l.id })).toBe(1);
  });
});

describe('debounce', () => {
  it('ten rapid submissions produce exactly one run, after the burst settles', async () => {
    await seedWorld({ learners: 10 }); // ten request.saved events
    await updateSettings({ debounceSeconds: 30 }, null);
    expect(await DomainEvent.countDocuments({ processedAt: null })).toBe(10);

    const early = await tick();
    expect(early.action).toBe('debouncing');
    expect(await AllocationRun.countDocuments()).toBe(0);

    await DomainEvent.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 60_000) } });
    const later = await tick();
    expect(later.action).toBe('ran');
    const again = await tick();
    expect(again.action).toBe('idle');
    expect(await AllocationRun.countDocuments()).toBe(1);
    const run = await AllocationRun.findOne().lean();
    expect(run?.eventIds).toHaveLength(10);
    expect(await DomainEvent.countDocuments({ processedAt: null })).toBe(0);
  });
});

describe('transactional publish', () => {
  it('a failure inside the transaction leaves no partial results', async () => {
    await seedWorld();
    const bundle = await buildSnapshotWithContext();
    const result = referenceEngine.runPipeline(bundle.snapshot, bundle.settings);
    expect(result.allocations.length).toBeGreaterThan(0);
    const run = await AllocationRun.create({ trigger: 'manual', status: 'Running', strategy: 'balanced', startedAt: new Date() });
    await expect(
      publishRun(run._id, bundle, result, { beforeCommit: () => { throw new Error('crash mid-publish'); } }),
    ).rejects.toThrow('crash mid-publish');
    expect(await Allocation.countDocuments()).toBe(0);
    expect(await Enrollment.countDocuments()).toBe(0);
    expect((await LearningRequest.find().lean()).every((r) => r.status === 'Submitted')).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'engine' })).toBe(0);
    expect((await AllocationRun.findById(run._id).lean())?.partitionState?.completedPhases).not.toContain('publish');
  });

  it('is idempotent by runId', async () => {
    await seedWorld();
    const bundle = await buildSnapshotWithContext();
    const result = referenceEngine.runPipeline(bundle.snapshot, bundle.settings);
    const run = await AllocationRun.create({ trigger: 'manual', status: 'Running', strategy: 'balanced', startedAt: new Date() });
    await publishRun(run._id, bundle, result);
    await publishRun(run._id, bundle, result);
    expect(await Allocation.countDocuments({ runId: run._id })).toBe(1);
    expect(await Enrollment.countDocuments({ runId: run._id })).toBe(3);
  });

  it('keeps an unchanged proposal on a re-run instead of re-notifying', async () => {
    const w = await seedWorld({ approvalMode: 'manual' });
    await executeRun({ trigger: 'manual' });
    const first = await Allocation.findOne().lean();
    await executeRun({ trigger: 'manual' });
    const allocs = await Allocation.find().lean();
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!._id.toString()).toBe(first!._id.toString());
    expect(await Enrollment.countDocuments({ status: { $in: ['Proposed', 'Waitlisted'] } })).toBe(3);
    expect(await Notification.countDocuments({ type: 'allocation.approvalNeeded', userId: w.giver.id })).toBe(1);
  });
});

describe('failures and retries', () => {
  it('a failed run is visible, notifies admins, keeps its events, and is retried on the next tick', async () => {
    const w = await seedWorld();
    state.throwOnce = true;
    const out = await executeRun({ trigger: 'manual' });
    expect(out.outcome).toBe('failed');
    const failed = await AllocationRun.findOne({ status: 'Failed' }).lean();
    expect(failed?.error).toBe('engine exploded');
    expect(await Notification.countDocuments({ type: 'run.failed', userId: w.admin.id })).toBe(1);
    expect(await DomainEvent.countDocuments({ processedAt: null })).toBe(3);

    const res = await tick();
    expect(res).toMatchObject({ action: 'ran', reason: 'retry' });
    const retry = await AllocationRun.findOne({ retryOf: failed!._id }).lean();
    expect(retry?.status).toBe('Completed');
    expect(retry?.partitionState?.attempts).toBe(2);
    expect(await DomainEvent.countDocuments({ processedAt: null })).toBe(0);
  });
});

describe('nightly', () => {
  it('re-optimises only Proposed allocations; confirmed ones are untouched', async () => {
    const w = await seedWorld({ approvalMode: 'manual', learners: 2 });
    // A confirmed class on the same space at another time, with an accepted learner.
    const other = await CourseOffering.create({
      courseId: w.course._id, providerUserId: w.provider.id, title: 'Data Basics', categoryId: w.category._id, batchSize: 5,
      sessionMinutes: 120, durationWeeks: 4, startDate: nextWeek(), status: 'Allocated',
    });
    const confirmed = await Allocation.create({
      offeringId: other._id, spaceId: w.space._id, providerUserId: w.provider.id, spaceOwnerUserId: w.giver.id,
      session: { dayOfWeek: 6, startTime: '14:00', endTime: '16:00' }, score: 0.9, strategy: 'balanced', status: 'ConfirmedByProvider',
    });
    const before = await Allocation.findById(confirmed._id).lean();
    await executeRun({ trigger: 'manual' });
    const res = await runNightly();
    expect(res.run.outcome).toBe('completed');
    const after = await Allocation.findById(confirmed._id).lean();
    expect(after?.status).toBe('ConfirmedByProvider');
    expect(after?.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
    expect(after?.session).toEqual(before!.session);
    // The engine filled the confirmed class's free seats only as offers on that same allocation.
    const nightlyRun = await AllocationRun.findOne({ trigger: 'nightly' }).lean();
    expect(await Allocation.countDocuments({ runId: nightlyRun!._id, offeringId: other._id })).toBe(0);
    expect(impact.computeImpactSnapshot).toHaveBeenCalled();
  });
});

describe('real Smart Allocation engine', () => {
  it('runs end to end and never exceeds a batch size', async () => {
    state.real = true;
    await seedWorld({ batchSize: 2, learners: 4 });
    const out = await executeRun({ trigger: 'manual' });
    expect(out.outcome).toBe('completed');
    const run = await AllocationRun.findOne().lean();
    expect(run?.status).toBe('Completed');
    expect(run?.metrics).toBeTruthy();
    expect(run?.baselineMetrics).toBeTruthy();
    for (const a of await Allocation.find().lean()) {
      const seats = await Enrollment.countDocuments({ allocationId: a._id, status: { $in: ['Proposed', 'Offered', 'Accepted'] } });
      expect(seats).toBeLessThanOrEqual(2);
    }
  });
});
