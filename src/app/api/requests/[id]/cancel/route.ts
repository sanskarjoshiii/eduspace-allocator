import { assertObjectId, ok, withAuth } from '@/server/http';
import { cancelRequest } from '@/server/services/requests';

type P = { id: string };

export const POST = withAuth<P>({ roles: ['Learner', 'Administrator'] }, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Request');
  return ok(await cancelRequest(user, params.id));
});
