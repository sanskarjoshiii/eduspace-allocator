import { created, ok, parseBody, parseQuery, withAuth } from '@/server/http';
import { CreateUserInput, UserListQuery } from '@/schemas/user';
import { adminCreateUser, listUsers } from '@/server/services/users';

export const GET = withAuth({ roles: ['Administrator'] }, async (req) => {
  const query = parseQuery(req, UserListQuery);
  return ok(await listUsers(query));
});

export const POST = withAuth({ roles: ['Administrator'] }, async (req, { user }) => {
  const input = await parseBody(req, CreateUserInput);
  return created(await adminCreateUser(user, input));
});
