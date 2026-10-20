import { assertObjectId, ok, withAuth } from '@/server/http';
import { acceptEnrollment } from '@/server/services/enrollments';

export const dynamic = 'force-dynamic';

export const POST = withAuth<{ id: string }>({ roles: ['Learner'] }, async (_req, { user, params }) => {
  return ok(await acceptEnrollment(user, assertObjectId(params.id, 'Enrollment')));
});
