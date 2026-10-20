// Space approval modes (PLAN 4.2): auto-approve policy-compliant allocations, or ask the
// Space Giver when the space is in manual mode.

import type { Types } from 'mongoose';
import type { SessionUser } from '@/server/auth/session';
import { Allocation } from '@/server/models';
import { baseVars, loadAllocationContext, seatsTaken } from './context';
import { safeNotify, setAllocationStatus } from './lifecycle';
import type { AllocationLean } from './types';

export interface ApprovalOutcome {
  autoApproved: string[];
  awaitingApproval: string[];
}

/** Applies each space's approval mode to Proposed allocations. Never throws per allocation. */
export async function applyApprovalMode(allocationIds: (Types.ObjectId | string)[], actor: SessionUser | null = null): Promise<ApprovalOutcome> {
  const out: ApprovalOutcome = { autoApproved: [], awaitingApproval: [] };
  if (allocationIds.length === 0) return out;
  const allocs = await Allocation.find({ _id: { $in: allocationIds }, status: 'Proposed' }).lean<AllocationLean[]>();
  for (const alloc of allocs) {
    const c = await loadAllocationContext(alloc);
    const vars = baseVars(c);
    const headcount = alloc.replacesAllocationId ? await seatsTaken(alloc.replacesAllocationId) : await seatsTaken(alloc._id);
    const href = `/allocations/${alloc._id.toString()}`;
    const related = { type: 'Allocation', id: alloc._id };
    if ((c.space.policy?.approvalMode ?? 'auto') === 'auto') {
      await setAllocationStatus(alloc._id, 'ApprovedBySpace', {
        actor,
        action: 'approve',
        note: 'Auto-approved under space policy',
        set: { approvedAt: new Date() },
      });
      out.autoApproved.push(alloc._id.toString());
      await safeNotify({ type: 'allocation.approved', userIds: [alloc.spaceOwnerUserId], vars, related, href });
      await safeNotify({
        type: 'allocation.approved',
        userIds: [alloc.providerUserId],
        vars: { ...vars, approvalNote: ' automatically under its policy' },
        related,
        href,
      });
    } else {
      out.awaitingApproval.push(alloc._id.toString());
      await safeNotify({ type: 'allocation.approvalNeeded', userIds: [alloc.spaceOwnerUserId], vars: { ...vars, headcount }, related, href });
      await safeNotify({ type: 'allocation.proposed', userIds: [alloc.providerUserId], vars: { ...vars, headcount }, related, href });
    }
  }
  return out;
}
