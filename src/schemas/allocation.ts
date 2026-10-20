import { z } from 'zod';
import { ALLOCATION_STATUSES } from '@/lib/domain';
import { ObjectIdString, WindowInput } from './common';

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};

/** GET /api/allocations. `status` may repeat (?status=Proposed&status=ApprovedBySpace). */
export const AllocationListQuery = z.object({
  ...page,
  status: z.union([z.enum(ALLOCATION_STATUSES), z.array(z.enum(ALLOCATION_STATUSES))]).optional(),
  runId: ObjectIdString.optional(),
  offeringId: ObjectIdString.optional(),
  spaceId: ObjectIdString.optional(),
});
export type AllocationListQuery = z.infer<typeof AllocationListQuery>;

/** Body for approve / reject / confirm. Optional free-text note kept in the status history. */
export const AllocationActionBody = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type AllocationActionBody = z.infer<typeof AllocationActionBody>;

export const OVERRIDE_ACTIONS = ['approve', 'confirm', 'reject', 'cancel', 'move'] as const;

/** POST /api/allocations/:id/override (Administrator only). A note is required and audited. */
export const AllocationOverrideBody = z
  .object({
    action: z.enum(OVERRIDE_ACTIONS),
    note: z.string().trim().min(3, 'Explain the override in a few words').max(1000),
    spaceId: ObjectIdString.optional(),
    session: WindowInput.optional(),
  })
  .refine((b) => b.action !== 'move' || Boolean(b.spaceId || b.session), {
    message: 'A move needs a target space, a new session, or both',
    path: ['spaceId'],
  });
export type AllocationOverrideBody = z.infer<typeof AllocationOverrideBody>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .transform((s) => new Date(`${s}T00:00:00Z`));

/** GET /api/schedules. */
export const ScheduleQuery = z.object({
  allocationId: ObjectIdString.optional(),
  mine: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  spaceId: ObjectIdString.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ScheduleQuery = z.infer<typeof ScheduleQuery>;
