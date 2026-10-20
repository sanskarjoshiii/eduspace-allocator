import { created, ok, parseBody, parseQuery, withAuth } from '@/server/http';
import { FeedbackInput, FeedbackQuery } from '@/schemas/feedback';
import { listFeedback, submitFeedback } from '@/server/services/feedback';

/** GET /api/feedback?offeringId=: feedback with the average rating (provider own, learner own, administrator all). */
export const GET = withAuth({ roles: ['Administrator', 'CourseProvider', 'Learner'] }, async (req, { user }) => {
  const { offeringId } = parseQuery(req, FeedbackQuery);
  return ok(await listFeedback(user, offeringId));
});

/** POST /api/feedback: a learner with an accepted seat rates the course, once. */
export const POST = withAuth({ roles: ['Learner'] }, async (req, { user }) => {
  const input = await parseBody(req, FeedbackInput);
  return created(await submitFeedback(user, input));
});
