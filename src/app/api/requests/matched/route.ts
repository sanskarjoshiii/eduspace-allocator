import { ok, parseQuery, withAuth } from '@/server/http';
import { RequestListQuery } from '@/schemas/request';
import { listMatched } from '@/server/services/requests';

export const GET = withAuth({ roles: ['CourseProvider', 'SpaceGiver'] }, async (req, { user }) => {
  const query = parseQuery(req, RequestListQuery);
  return ok(await listMatched(user, query));
});
