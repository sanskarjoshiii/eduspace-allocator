import { z } from 'zod';
import { FACILITY_ISSUE_STATUSES } from '@/lib/domain';
import { ObjectIdString } from './common';

/** POST /api/facility-issues. */
export const FacilityIssueInput = z.object({
  spaceId: ObjectIdString,
  facilityTypeId: ObjectIdString,
  affectedQuantity: z.number().int().min(1, 'At least 1 unit').max(10_000),
  description: z.string().trim().max(2000).optional().default(''),
  evidenceUrl: z.union([z.url('Use a full https:// link'), z.literal('')]).optional().default(''),
});
export type FacilityIssueInput = z.infer<typeof FacilityIssueInput>;

/** POST /api/facility-issues/:id/resolve. */
export const FacilityIssueResolveBody = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type FacilityIssueResolveBody = z.infer<typeof FacilityIssueResolveBody>;

/** GET /api/facility-issues. */
export const FacilityIssueListQuery = z.object({
  status: z.enum(FACILITY_ISSUE_STATUSES).optional(),
  spaceId: ObjectIdString.optional(),
});
export type FacilityIssueListQuery = z.infer<typeof FacilityIssueListQuery>;
