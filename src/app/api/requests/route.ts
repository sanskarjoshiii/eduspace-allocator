import { created, ok, parseBody, parseQuery, withAuth } from '@/server/http';
import { RequestInput, RequestListQuery } from '@/schemas/request';
import { createRequest, listRequests } from '@/server/services/requests';

/** Administrators: all. Learners: own. Providers and space givers: matched only, redacted. */
export const GET = withAuth({}, async (req, { user }) => {
  const query = parseQuery(req, RequestListQuery);
  return ok(await listRequests(user, query));
});

export const POST = withAuth({ roles: ['Learner'] }, async (req, { user }) => {
  const input = await parseBody(req, RequestInput);
  return created(await createRequest(user, input));
});
