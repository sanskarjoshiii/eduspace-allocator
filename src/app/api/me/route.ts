import { ok, parseBody, withAuth } from '@/server/http';
import { MeUpdate } from '@/schemas/user';
import { getMe, updateMe } from '@/server/services/users';

export const GET = withAuth({}, async (_req, { user }) => ok(await getMe(user)));

export const PATCH = withAuth({}, async (req, { user }) => {
  const input = await parseBody(req, MeUpdate);
  return ok(await updateMe(user, input));
});
