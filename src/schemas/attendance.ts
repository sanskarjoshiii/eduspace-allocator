import { z } from 'zod';
import { ObjectIdString } from './common';

/** POST /api/attendance: mark one held session. */
export const AttendanceInput = z.object({
  scheduleId: ObjectIdString,
  records: z
    .array(z.object({ enrollmentId: ObjectIdString, present: z.boolean() }))
    .min(1, 'Mark at least one learner')
    .max(500)
    .refine((r) => new Set(r.map((x) => x.enrollmentId)).size === r.length, { message: 'Each learner can be marked once' }),
});
export type AttendanceInput = z.infer<typeof AttendanceInput>;

export const AttendanceQuery = z.object({ allocationId: ObjectIdString });
export type AttendanceQuery = z.infer<typeof AttendanceQuery>;
