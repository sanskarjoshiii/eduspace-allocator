import { assertObjectId, ok, parseBody, withAuth } from '@/server/http';
import { UserUpdate } from '@/schemas/user';
import { getUser, updateUser } from '@/server/services/users';

type P = { id: string };

export const GET = withAuth<P>({ roles: ['Administrator'] }, async (_req, { params }) => {
  assertObjectId(params.id, 'User');
  return ok(await getUser(params.id));
});

export const PATCH = withAuth<P>({ roles: ['Administrator'] }, async (req, { user, params }) => {
  assertObjectId(params.id, 'User');
  const input = await parseBody(req, UserUpdate);
  return ok(await updateUser(user, params.id, input));
});
