import { assertObjectId, ok, withAuth } from '@/server/http';
import { declineEnrollment } from '@/server/services/enrollments';

export const dynamic = 'force-dynamic';

export const POST = withAuth<{ id: string }>({ roles: ['Learner'] }, async (_req, { user, params }) => {
  return ok(await declineEnrollment(user, assertObjectId(params.id, 'Enrollment')));
});
