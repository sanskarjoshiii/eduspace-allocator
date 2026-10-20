import { z } from 'zod';
import { AUDIENCES, OFFERING_STATUSES } from '@/lib/domain';
import { Money, ObjectIdString, WindowInput, noOverlap } from './common';

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Statuses a Course Provider may set; the others are managed by Smart Allocation. */
export const PROVIDER_OFFERING_STATUSES = ['Draft', 'Open', 'Cancelled'] as const;

const OfferingBase = z.object({
  courseId: ObjectIdString,
  audience: z.enum(AUDIENCES).optional(),
  batchSize: z.number().int().min(1, 'At least one seat').max(1000),
  sessionMinutes: z.number().int().min(30, 'At least 30 minutes').max(480, 'At most 8 hours'),
  durationWeeks: z.number().int().min(1).max(104),
  /** ISO date (YYYY-MM-DD or a full ISO string). */
  startDate: z.coerce.date({ error: 'Enter a valid start date' }),
  targetAreaId: ObjectIdString.nullable().optional(),
  windows: z.array(WindowInput).max(21).optional(),
  /** Most rent per hour the provider will pay. Null = no limit. */
  maxRentPerHour: Money.nullable().optional(),
  /** What a learner pays per month. Null or 0 = free. */
  feePerMonth: Money.nullable().optional(),
  status: z.enum(OFFERING_STATUSES).optional(),
});

function checkOffering(v: Partial<z.infer<typeof OfferingBase>>, ctx: z.RefinementCtx): void {
  if (!v.windows || v.windows.length === 0) return;
  if (!noOverlap(v.windows)) {
    ctx.addIssue({ code: 'custom', path: ['windows'], message: 'Windows on the same day cannot overlap' });
  }
  if (v.sessionMinutes !== undefined) {
    const minutes = v.sessionMinutes;
    const fits = v.windows.some((w) => toMin(w.endTime) - toMin(w.startTime) >= minutes);
    if (!fits) ctx.addIssue({ code: 'custom', path: ['sessionMinutes'], message: 'The session must fit inside at least one window' });
  }
}

/** POST /api/offerings. Title and category come from the course. */
export const OfferingInput = OfferingBase.superRefine(checkOffering);
export type OfferingInput = z.input<typeof OfferingInput>;
/** PATCH /api/offerings/[id]. The course cannot change. */
export const OfferingUpdate = OfferingBase.omit({ courseId: true }).partial().superRefine(checkOffering);
export type OfferingUpdate = z.input<typeof OfferingUpdate>;

export const OfferingListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  mine: z.enum(['1', 'true', '0', 'false']).optional(),
  status: z.enum(OFFERING_STATUSES).optional(),
  categoryId: ObjectIdString.optional(),
  areaId: ObjectIdString.optional(),
  courseId: ObjectIdString.optional(),
});
