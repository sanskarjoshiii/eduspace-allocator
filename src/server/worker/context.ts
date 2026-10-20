import type { Types } from 'mongoose';
import { Allocation, Area, CourseCategory, CourseOffering, Enrollment, Space } from '@/server/models';
import { HttpError } from '@/server/http';
import { SEAT_HOLDING_ENROLLMENT_STATUSES } from '@/lib/domain';
import { sessionLabel } from './lifecycle';
import type { AllocationLean, OfferingLean, SpaceLean } from './types';

/** An allocation with the records its notifications and DTOs need. */
export interface AllocationContext {
  alloc: AllocationLean;
  offering: OfferingLean;
  space: SpaceLean;
  areaName: string;
  categoryName: string;
  session: string;
}

export async function loadAllocation(id: Types.ObjectId | string): Promise<AllocationLean> {
  const alloc = await Allocation.findById(id).lean<AllocationLean>();
  if (!alloc) throw new HttpError(404, 'not_found', 'Allocation not found.');
  return alloc;
}

export async function loadAllocationContext(allocOrId: AllocationLean | Types.ObjectId | string): Promise<AllocationContext> {
  const alloc = typeof allocOrId === 'object' && 'status' in allocOrId ? allocOrId : await loadAllocation(allocOrId);
  const [offering, space] = await Promise.all([
    CourseOffering.findById(alloc.offeringId).lean<OfferingLean>(),
    Space.findById(alloc.spaceId).lean<SpaceLean>(),
  ]);
  if (!offering || !space) throw new HttpError(404, 'not_found', 'The offering or space for this allocation no longer exists.');
  const [area, category] = await Promise.all([
    Area.findById(space.areaId).select('name').lean(),
    CourseCategory.findById(offering.categoryId).select('name').lean(),
  ]);
  return { alloc, offering, space, areaName: area?.name ?? '', categoryName: category?.name ?? '', session: sessionLabel(alloc.session) };
}

/** Template variables most allocation notifications share. */
export function baseVars(c: AllocationContext): Record<string, string> {
  return { courseTitle: c.offering.title, spaceName: c.space.name, areaName: c.areaName, session: c.session };
}

/** Seats held (Proposed, Offered, Accepted) on an allocation. */
export async function seatsTaken(allocationId: Types.ObjectId | string): Promise<number> {
  return Enrollment.countDocuments({ allocationId, status: { $in: SEAT_HOLDING_ENROLLMENT_STATUSES } });
}

/** Learner user ids holding an enrollment on an allocation in the given statuses. */
export async function learnersOn(allocationId: Types.ObjectId | string, statuses: readonly string[]): Promise<Types.ObjectId[]> {
  const rows = await Enrollment.find({ allocationId, status: { $in: statuses } }).select('learnerUserId').lean();
  return rows.map((r) => r.learnerUserId);
}
