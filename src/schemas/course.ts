import { z } from 'zod';
import { ObjectIdString } from './common';

export const RequirementInput = z.object({
  facilityTypeId: ObjectIdString,
  minQuantity: z.number().int().min(1).max(10_000),
});

const CourseBase = z.object({
  title: z.string().trim().min(2, 'Enter a title').max(160),
  description: z.string().trim().max(4000).optional(),
  categoryId: ObjectIdString,
  requirements: z.array(RequirementInput).max(30).optional(),
  coverUrl: z.union([z.url('Enter a valid URL').max(1000), z.literal('')]).optional(),
  /** Administrators only: create the course on behalf of this Course Provider. */
  providerUserId: ObjectIdString.optional(),
});

function checkCourse(v: Partial<z.infer<typeof CourseBase>>, ctx: z.RefinementCtx): void {
  if (v.requirements) {
    const ids = v.requirements.map((r) => r.facilityTypeId.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['requirements'], message: 'Each facility type can be listed once' });
    }
  }
}

/** POST /api/courses */
export const CourseInput = CourseBase.superRefine(checkCourse);
export type CourseInput = z.input<typeof CourseInput>;
/** PATCH /api/courses/[id] */
export const CourseUpdate = CourseBase.omit({ providerUserId: true }).partial().superRefine(checkCourse);
export type CourseUpdate = z.input<typeof CourseUpdate>;

export const CourseListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  mine: z.enum(['1', 'true', '0', 'false']).optional(),
  categoryId: ObjectIdString.optional(),
});
