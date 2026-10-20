// Administrator run monitor (PLAN 3.15, 7.9): list, detail with the baseline comparison,
// manual trigger and retry.

import { Types } from 'mongoose';
import type { SessionUser } from '@/server/auth/session';
import { conflict, notFound, pageMeta } from '@/server/http';
import { AllocationRun } from '@/server/models';
import { audit } from '@/server/services/audit';
import { emitEvent } from '@/server/services/events';
import { toRunDetail, toRunListItem, type RunDetailDto, type RunListItemDto } from '@/server/dto/run';
import type { RunListQuery } from '@/schemas/run';
import { isLocked } from '@/server/worker/lock';
import { executeRun, type RunOutcome } from '@/server/worker/run';
import type { RunLean } from '@/server/worker/types';

export async function listRuns(q: RunListQuery): Promise<{ items: RunListItemDto[]; meta: ReturnType<typeof pageMeta> }> {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.trigger) filter.trigger = q.trigger;
  const [total, rows] = await Promise.all([
    AllocationRun.countDocuments(filter),
    AllocationRun.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean<RunLean[]>(),
  ]);
  return { items: rows.map(toRunListItem), meta: pageMeta(total, q.page, q.pageSize) };
}

export async function getRun(id: Types.ObjectId): Promise<RunDetailDto> {
  const run = await AllocationRun.findById(id).lean<RunLean>();
  if (!run) throw notFound('Run');
  const retries = await AllocationRun.find({ retryOf: run._id }).select('status').lean<RunLean[]>();
  return toRunDetail(run, retries.map((r) => ({ id: r._id.toString(), status: r.status })));
}

async function finish(outcome: RunOutcome): Promise<RunDetailDto> {
  if (outcome.outcome === 'locked') throw conflict('A run is already in progress. Try again in a minute.');
  return getRun(new Types.ObjectId(outcome.runId));
}

/** Manual trigger: records a manual.trigger event and runs now (no debounce) if the lock is free. */
export async function triggerRun(user: SessionUser, note?: string): Promise<RunDetailDto> {
  if (await isLocked()) throw conflict('A run is already in progress. Try again in a minute.');
  await emitEvent('manual.trigger', null, { by: user.id, note: note ?? '' });
  const outcome = await executeRun({ trigger: 'manual', triggeredBy: user.id });
  if (outcome.outcome !== 'locked') {
    await audit({ actor: user, action: 'create', entity: 'AllocationRun', entityId: outcome.runId, ownerUserId: null, diff: { trigger: 'manual', note: note ?? '' } });
  }
  return finish(outcome);
}

/** Re-runs a failed run now (a new run with retryOf). */
export async function retryRun(user: SessionUser, id: Types.ObjectId): Promise<RunDetailDto> {
  const run = await AllocationRun.findById(id).lean<RunLean>();
  if (!run) throw notFound('Run');
  if (run.status !== 'Failed') throw conflict('Only a failed run can be retried.');
  if (await isLocked()) throw conflict('A run is already in progress. Try again in a minute.');
  const outcome = await executeRun({ trigger: run.trigger, triggeredBy: user.id, retryOf: run._id });
  if (outcome.outcome !== 'locked') {
    await audit({ actor: user, action: 'create', entity: 'AllocationRun', entityId: outcome.runId, ownerUserId: null, diff: { retryOf: run._id.toString() } });
  }
  return finish(outcome);
}
