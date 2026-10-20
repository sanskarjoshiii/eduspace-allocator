// Nightly job (PLAN 3.14): re-optimise unconfirmed allocations, move classes through
// their lifecycle, refresh impact numbers and demand alerts.

import { Types } from 'mongoose';
import { logger } from '@/lib/logger';
import { Allocation, CourseOffering, Enrollment, Schedule } from '@/server/models';
import { evaluateDemandAlerts } from '@/server/services/alerts';
import { computeImpactSnapshot } from '@/server/services/impact';
import { baseVars, loadAllocationContext } from './context';
import { istToday, safeNotify, setAllocationStatus, setRequestStatus } from './lifecycle';
import { executeRun, type RunOutcome } from './run';
import type { AllocationLean, EnrollmentLean } from './types';

export interface LifecycleResult {
  activated: string[];
  completed: string[];
}

/**
 * Scheduled → Active once the first session date has arrived; Active → Completed once the
 * last session date has passed. Offerings and the learners' requests follow; learners of
 * a completed class are asked to rate it.
 */
export async function progressLifecycles(now: Date = new Date()): Promise<LifecycleResult> {
  const today = istToday(now);
  const out: LifecycleResult = { activated: [], completed: [] };
  const occupying = { $in: ['Planned', 'Held'] };

  const scheduled = await Allocation.find({ status: 'Scheduled' }).lean<AllocationLean[]>();
  for (const a of scheduled) {
    const first = await Schedule.findOne({ allocationId: a._id, status: occupying }).sort({ date: 1 }).select('date').lean<{ date: Date }>();
    if (!first || first.date > today) continue;
    try {
      await setAllocationStatus(a._id, 'Active', { note: 'First session reached' });
      await CourseOffering.updateOne({ _id: a.offeringId, status: { $in: ['Open', 'Allocated'] } }, { $set: { status: 'Active' } });
      const accepted = await Enrollment.find({ allocationId: a._id, status: 'Accepted' }).select('requestId').lean<EnrollmentLean[]>();
      await setRequestStatus(accepted.map((e) => e.requestId), 'Active', { onlyFrom: ['Accepted', 'Scheduled'] });
      out.activated.push(a._id.toString());
    } catch (err) {
      logger.warn('nightly.activate_failed', { allocationId: a._id.toString(), message: (err as Error).message });
    }
  }

  const active = await Allocation.find({ status: 'Active' }).lean<AllocationLean[]>();
  for (const a of active) {
    const last = await Schedule.findOne({ allocationId: a._id, status: occupying }).sort({ date: -1 }).select('date').lean<{ date: Date }>();
    if (!last || last.date >= today) continue;
    try {
      await setAllocationStatus(a._id, 'Completed', { note: 'Last session held' });
      const live = await Allocation.countDocuments({ offeringId: a.offeringId, status: { $in: ['Proposed', 'ApprovedBySpace', 'ConfirmedByProvider', 'Scheduled', 'Active', 'NeedsReallocation'] } });
      if (live === 0) await CourseOffering.updateOne({ _id: a.offeringId }, { $set: { status: 'Completed' } });
      const accepted = await Enrollment.find({ allocationId: a._id, status: 'Accepted' }).select('requestId learnerUserId').lean<EnrollmentLean[]>();
      await setRequestStatus(accepted.map((e) => e.requestId), 'Completed', { onlyFrom: ['Accepted', 'Scheduled', 'Active'] });
      const c = await loadAllocationContext(a);
      await safeNotify({
        type: 'course.completed',
        userIds: accepted.map((e) => e.learnerUserId as Types.ObjectId),
        vars: baseVars(c),
        related: { type: 'Allocation', id: a._id },
        href: `/feedback?allocationId=${a._id.toString()}`,
      });
      out.completed.push(a._id.toString());
    } catch (err) {
      logger.warn('nightly.complete_failed', { allocationId: a._id.toString(), message: (err as Error).message });
    }
  }
  return out;
}

export interface NightlyResult {
  run: RunOutcome;
  lifecycle: LifecycleResult;
}

/**
 * The nightly run passes every confirmed, scheduled or active allocation to the engine
 * as fixed, so it can only replace Proposed allocations: confirmed classes never move here.
 */
export async function runNightly(now: Date = new Date()): Promise<NightlyResult> {
  const run = await executeRun({ trigger: 'nightly' });
  const lifecycle = await progressLifecycles(now);
  try {
    await computeImpactSnapshot();
  } catch (err) {
    logger.error('nightly.impact_failed', { message: (err as Error).message });
  }
  try {
    await evaluateDemandAlerts();
  } catch (err) {
    logger.error('nightly.alerts_failed', { message: (err as Error).message });
  }
  return { run, lifecycle };
}
