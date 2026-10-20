import { z } from 'zod';
import { REQUEST_STATUSES } from '@/lib/domain';
import { Money, ObjectIdString, PointInput, WindowInput, noOverlap } from './common';

/** Statuses in which the learner may still edit a request. */
export const EDITABLE_REQUEST_STATUSES = ['Submitted', 'Analysed', 'Unmatched'] as const;

const RequestBase = z.object({
  categoryId: ObjectIdString,
  /** Exact point [lng, lat]. Private to the learner and administrators. */
  location: PointInput,
  maxDistanceKm: z.number().min(0.5, 'At least 0.5 km').max(50, 'At most 50 km'),
  startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  durationMonths: z.number().int().min(1).max(24),
  consentShared: z.boolean().refine((v) => v === true, { message: 'Consent is required' }),
  /** Empty = flexible to the tutor's timing. */
  windows: z.array(WindowInput).max(21).optional(),
  requiredFacilityTypeIds: z.array(ObjectIdString).max(30).optional(),
  budgetPerMonth: Money.nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
});

function checkRequest(v: Partial<z.infer<typeof RequestBase>>, ctx: z.RefinementCtx): void {
  if (v.windows && !noOverlap(v.windows)) {
    ctx.addIssue({ code: 'custom', path: ['windows'], message: 'Windows on the same day cannot overlap' });
  }
}

/** POST /api/requests (Learner). */
export const RequestInput = RequestBase.superRefine(checkRequest);
export type RequestInput = z.input<typeof RequestInput>;
/** PATCH /api/requests/[id] (Learner, while Submitted, Analysed or Unmatched). */
export const RequestUpdate = RequestBase.partial().superRefine(checkRequest);
export type RequestUpdate = z.input<typeof RequestUpdate>;

export const RequestListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(REQUEST_STATUSES).optional(),
  categoryId: ObjectIdString.optional(),
  areaId: ObjectIdString.optional(),
});
