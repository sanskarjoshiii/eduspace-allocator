import { z } from 'zod';
import { ObjectIdString } from './common';

/** GET /api/enrollments?allocationId= (roster). */
export const RosterQuery = z.object({
  allocationId: ObjectIdString,
});
export type RosterQuery = z.infer<typeof RosterQuery>;

/** Accept / decline take no fields; an empty object (or no body) is fine. */
export const EnrollmentActionBody = z.object({}).passthrough();
