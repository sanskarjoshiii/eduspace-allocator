import { ok, parseQuery, withAuth } from '@/server/http';
import { RequestListQuery } from '@/schemas/request';
import { listMine } from '@/server/services/requests';

export const GET = withAuth({ roles: ['Learner'] }, async (req, { user }) => {
  const query = parseQuery(req, RequestListQuery);
  return ok(await listMine(user, query));
});
