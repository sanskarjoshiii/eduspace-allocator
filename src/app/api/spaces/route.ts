import { created, ok, parseBody, parseQuery, withAuth } from '@/server/http';
import { SpaceInput, SpaceListQuery } from '@/schemas/space';
import { createSpace, listSpaces } from '@/server/services/spaces';

export const GET = withAuth({}, async (req, { user }) => {
  const query = parseQuery(req, SpaceListQuery);
  return ok(await listSpaces(user, query));
});

export const POST = withAuth({ roles: ['SpaceGiver', 'Administrator'] }, async (req, { user }) => {
  const input = await parseBody(req, SpaceInput);
  return created(await createSpace(user, input));
});
