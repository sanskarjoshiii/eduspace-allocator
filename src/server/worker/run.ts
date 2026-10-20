// Allocation run orchestration (PLAN 3.12): debounce, single-run lock, run lifecycle,
// recovery of interrupted runs, and automatic retries.
//
// Phases: snapshot → engine → publish → notify → done, recorded in
// partitionState.completedPhases. The snapshot and engine phases are pure reads, so a run
// that dies before publish has written nothing; it is marked Failed (visibly) and retried.
// Publish is one transaction; a run that dies after it resumes at the notify phase.

import { Types } from 'mongoose';
import type { RunTrigger } from '@/lib/domain';
import { logger } from '@/lib/logger';
import { Allocation, AllocationRun, CourseCategory, Enrollment, LearningRequest } from '@/server/models';
import { getSettings, type Settings } from '@/server/services/settings';
import { getEngine } from '@/server/services/engine-client';
import { evaluateDemandAlerts } from '@/server/services/alerts';
import { adminIds } from '@/server/notifications/notify';
import { audit } from '@/server/services/audit';
import { formatDateTime, formatKm } from '@/lib/format';
import { applyApprovalMode } from './approval';
import { loadAllocationContext } from './context';
import { acquireLock, extendLock, newHolderId, releaseLock } from './lock';
import { safeNotify } from './lifecycle';
import { outboxState, pendingEventIds } from './outbox';
import { publishRun, runRef, type PublishOptions, type PublishOutcome } from './publish';
import { buildSnapshotWithContext } from './snapshot';
import type { EnrollmentLean, RunLean } from './types';

type Id = Types.ObjectId;

export interface RunOptions {
  trigger: RunTrigger;
  triggeredBy?: string | null;
  retryOf?: Id | null;
  /** Test hooks forwarded to publish. */
  publish?: PublishOptions;
}

export type RunOutcome =
  | { outcome: 'completed'; runId: string; publish: PublishOutcome }
  | { outcome: 'failed'; runId: string; error: string }
  | { outcome: 'locked' };

/** Takes the lock and executes one run. Returns 'locked' when another run holds it. */
export async function executeRun(opts: RunOptions): Promise<RunOutcome> {
  const settings = await getSettings();
  const holder = newHolderId();
  if (!(await acquireLock(holder, settings.runLockTtlSeconds))) return { outcome: 'locked' };
  try {
    return await runLocked(opts, holder, settings);
  } finally {
    await releaseLock(holder);
  }
}

async function markPhase(runId: Id, phase: string, completed: string | null): Promise<void> {
  await AllocationRun.updateOne(
    { _id: runId },
    { $set: { 'partitionState.phase': phase }, ...(completed ? { $addToSet: { 'partitionState.completedPhases': completed } } : {}) },
  );
}

/** Runs with the lock already held by `holder`. */
export async function runLocked(opts: RunOptions, holder: string, settings: Settings): Promise<RunOutcome> {
  const startedAt = new Date();
  let attempts = 1;
  if (opts.retryOf) {
    const parent = await AllocationRun.findById(opts.retryOf).select('partitionState').lean<RunLean>();
    attempts = Math.max(1, parent?.partitionState?.attempts ?? 1) + 1;
  }
  const run = await AllocationRun.create({
    trigger: opts.trigger,
    status: 'Running',
    strategy: settings.strategy,
    triggeredBy: opts.triggeredBy ? new Types.ObjectId(opts.triggeredBy) : null,
    startedAt,
    eventIds: await pendingEventIds(startedAt),
    retryOf: opts.retryOf ?? null,
    partitionState: { phase: 'snapshot', attempts, completedPhases: [] },
  });
  const runId = run._id;
  logger.info('run.started', { runId: runId.toString(), trigger: opts.trigger, attempts });

  try {
    const bundle = await buildSnapshotWithContext({ trigger: opts.trigger, now: startedAt });
    await markPhase(runId, 'engine', 'snapshot');
    await extendLock(holder, settings.runLockTtlSeconds);

    const t0 = Date.now();
    const result = getEngine().runPipeline(bundle.snapshot, bundle.settings);
    if (!result.metrics.runTimeMs) result.metrics.runTimeMs = Date.now() - t0;
    await markPhase(runId, 'publish', 'engine');
    await extendLock(holder, settings.runLockTtlSeconds);

    const outcome = await publishRun(runId, bundle, result, { now: startedAt, ...opts.publish });
    await extendLock(holder, settings.runLockTtlSeconds);

    await notifyPhase(runId, outcome);
    await AllocationRun.updateOne(
      { _id: runId },
      { $set: { status: 'Completed', finishedAt: new Date(), 'partitionState.phase': 'done' }, $addToSet: { 'partitionState.completedPhases': { $each: ['notify', 'done'] } } },
    );
    logger.info('run.completed', { runId: runId.toString(), counts: outcome.counts });
    return { outcome: 'completed', runId: runId.toString(), publish: outcome };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failRun(runId, message, attempts, settings);
    return { outcome: 'failed', runId: runId.toString(), error: message };
  }
}

async function failRun(runId: Id, message: string, attempts: number, settings: Settings): Promise<void> {
  logger.error('run.failed', { runId: runId.toString(), message });
  await AllocationRun.updateOne({ _id: runId }, { $set: { status: 'Failed', error: message.slice(0, 2000), finishedAt: new Date() } });
  await audit({ actor: null, action: 'engine', entity: 'AllocationRun', entityId: runId, ownerUserId: null, diff: { status: 'Failed', error: message.slice(0, 500) } });
  const retryNote =
    attempts <= settings.maxRunRetries
      ? `A retry is scheduled for the next tick (attempt ${attempts + 1} of ${settings.maxRunRetries + 1}).`
      : 'No automatic retries left; trigger a run from the run monitor.';
  await safeNotify({
    type: 'run.failed',
    userIds: await adminIds(),
    vars: { runRef: runRef(runId), error: message.slice(0, 300), retryNote },
    related: { type: 'AllocationRun', id: runId },
    href: `/runs/${runId.toString()}`,
  });
}

/**
 * After publish (outside the transaction): space approval modes for new proposals,
 * offers for seats filled on confirmed classes, unmatched learners told, demand alerts.
 * Reads from the database by runId so a resumed run can repeat it.
 */
export async function notifyPhase(runId: Id, outcome: PublishOutcome | null): Promise<void> {
  const newIds = outcome
    ? outcome.newAllocationIds.map((id) => new Types.ObjectId(id))
    : (await Allocation.find({ runId, status: 'Proposed', replacesAllocationId: null }).select('_id').lean()).map((a) => a._id);
  try {
    await applyApprovalMode(newIds, null);
  } catch (err) {
    logger.error('run.approval_failed', { runId: runId.toString(), message: (err as Error).message });
  }

  const offeredFilter = outcome
    ? { _id: { $in: outcome.offeredEnrollmentIds.map((id) => new Types.ObjectId(id)) } }
    : { runId, status: 'Offered' };
  const offered = await Enrollment.find(offeredFilter).lean<EnrollmentLean[]>();
  for (const e of offered) {
    if (!e.allocationId) continue;
    try {
      const c = await loadAllocationContext(e.allocationId);
      await safeNotify({
        type: 'offer.sent',
        userIds: [e.learnerUserId],
        vars: {
          courseTitle: c.offering.title,
          spaceName: c.space.name,
          session: c.session,
          distance: e.distanceKm !== null && e.distanceKm !== undefined ? formatKm(e.distanceKm) : 'a short distance',
          expiresAt: formatDateTime(e.offerExpiresAt),
        },
        related: { type: 'Enrollment', id: e._id },
        href: '/offers',
      });
    } catch (err) {
      logger.warn('run.offer_notify_failed', { enrollmentId: e._id.toString(), message: (err as Error).message });
    }
  }

  const unmatchedFilter = outcome
    ? { _id: { $in: outcome.newlyUnmatchedRequestIds.map((id) => new Types.ObjectId(id)) }, status: 'Unmatched' }
    : { lastRunId: runId, status: 'Unmatched' };
  const unmatched = await LearningRequest.find(unmatchedFilter).select('learnerUserId categoryId suggestions').lean();
  if (unmatched.length > 0) {
    const cats = await CourseCategory.find({ _id: { $in: unmatched.map((u) => u.categoryId) } }).select('name').lean();
    const name = new Map(cats.map((c) => [c._id.toString(), c.name]));
    for (const u of unmatched) {
      await safeNotify({
        type: 'request.unmatched',
        userIds: [u.learnerUserId],
        vars: { categoryName: name.get(u.categoryId.toString()) ?? '', suggestionCount: (u.suggestions ?? []).length },
        related: { type: 'LearningRequest', id: u._id },
        href: `/requests/${u._id.toString()}`,
      });
    }
  }

  try {
    await evaluateDemandAlerts();
  } catch (err) {
    logger.error('run.alerts_failed', { runId: runId.toString(), message: (err as Error).message });
  }
}

/**
 * Runs left in Running while nobody holds the lock died mid-way. Before publish nothing
 * was written, so they fail visibly (and are retried); after publish they resume at notify.
 */
export async function recoverStaleRuns(settings: Settings): Promise<{ failed: string[]; resumed: string[] }> {
  const stale = await AllocationRun.find({ status: 'Running' }).lean<RunLean[]>();
  const failed: string[] = [];
  const resumed: string[] = [];
  for (const run of stale) {
    const done = run.partitionState?.completedPhases ?? [];
    if (done.includes('publish')) {
      await notifyPhase(run._id, null);
      await AllocationRun.updateOne(
        { _id: run._id },
        {
          $set: { status: 'Completed', finishedAt: new Date(), 'partitionState.phase': 'done', error: 'Resumed after an interruption at the notify phase.' },
          $addToSet: { 'partitionState.completedPhases': { $each: ['notify', 'done'] } },
        },
      );
      resumed.push(run._id.toString());
    } else {
      await failRun(
        run._id,
        `Run stopped during the ${run.partitionState?.phase ?? 'unknown'} phase (its lock expired). No results were saved.`,
        Math.max(1, run.partitionState?.attempts ?? 1),
        settings,
      );
      failed.push(run._id.toString());
    }
  }
  return { failed, resumed };
}

/** The most recent failed run that still has retries left and has not been retried. */
async function retryCandidate(settings: Settings): Promise<RunLean | null> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const failed = await AllocationRun.find({ status: 'Failed', createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(10).lean<RunLean[]>();
  for (const f of failed) {
    if (Math.max(1, f.partitionState?.attempts ?? 1) > settings.maxRunRetries) continue;
    const retried = await AllocationRun.exists({ retryOf: f._id });
    if (!retried) return f;
  }
  return null;
}

export type TickResult =
  | { action: 'locked' }
  | { action: 'idle'; recovered: { failed: string[]; resumed: string[] } }
  | { action: 'debouncing'; pending: number; waitSeconds: number; recovered: { failed: string[]; resumed: string[] } }
  | { action: 'ran'; reason: 'events' | 'retry'; run: RunOutcome; recovered: { failed: string[]; resumed: string[] } };

/**
 * One worker tick (Vercel Cron, every few minutes): recover interrupted runs, retry a
 * failed run, or start a run when the outbox burst has settled. At most one run per tick.
 */
export async function tick(now: Date = new Date()): Promise<TickResult> {
  const settings = await getSettings();
  const holder = newHolderId();
  if (!(await acquireLock(holder, settings.runLockTtlSeconds, now))) return { action: 'locked' };
  try {
    const recovered = await recoverStaleRuns(settings);
    const retry = await retryCandidate(settings);
    if (retry) {
      const run = await runLocked({ trigger: retry.trigger, retryOf: retry._id, triggeredBy: retry.triggeredBy?.toString() ?? null }, holder, settings);
      return { action: 'ran', reason: 'retry', run, recovered };
    }
    const outbox = await outboxState(settings.debounceSeconds, now);
    if (outbox.pending === 0) return { action: 'idle', recovered };
    if (!outbox.ready) return { action: 'debouncing', pending: outbox.pending, waitSeconds: outbox.waitSeconds, recovered };
    const run = await runLocked({ trigger: 'event' }, holder, settings);
    return { action: 'ran', reason: 'events', run, recovered };
  } finally {
    await releaseLock(holder);
  }
}
