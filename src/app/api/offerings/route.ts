import { created, ok, parseBody, parseQuery, withAuth } from '@/server/http';
import { OfferingInput, OfferingListQuery } from '@/schemas/offering';
import { createOffering, listOfferings } from '@/server/services/offerings';

export const GET = withAuth({}, async (req, { user }) => {
  const query = parseQuery(req, OfferingListQuery);
  return ok(await listOfferings(user, query));
});

export const POST = withAuth({ roles: ['CourseProvider', 'Administrator'] }, async (req, { user }) => {
  const input = await parseBody(req, OfferingInput);
  return created(await createOffering(user, input));
});
