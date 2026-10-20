import { assertObjectId, ok, parseBody, withAuth } from '@/server/http';
import { RequestUpdate } from '@/schemas/request';
import { getRequest, updateRequest } from '@/server/services/requests';

type P = { id: string };

export const GET = withAuth<P>({}, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Request');
  return ok(await getRequest(user, params.id));
});

export const PATCH = withAuth<P>({ roles: ['Learner', 'Administrator'] }, async (req, { user, params }) => {
  assertObjectId(params.id, 'Request');
  const input = await parseBody(req, RequestUpdate);
  return ok(await updateRequest(user, params.id, input));
});
