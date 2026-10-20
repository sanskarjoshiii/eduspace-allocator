import { z } from 'zod';
import { ObjectIdString } from './common';

/** POST /api/feedback: one rating per accepted enrollment. */
export const FeedbackInput = z.object({
  enrollmentId: ObjectIdString,
  rating: z.number().int().min(1, 'Rate from 1 to 5').max(5, 'Rate from 1 to 5'),
  comment: z.string().trim().max(2000, 'Keep the comment under 2,000 characters').default(''),
});
export type FeedbackInput = z.infer<typeof FeedbackInput>;

export const FeedbackQuery = z.object({ offeringId: ObjectIdString.optional() });
export type FeedbackQuery = z.infer<typeof FeedbackQuery>;
