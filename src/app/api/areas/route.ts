import { created, ok, parseBody, parseQuery, withAuth, withPublic } from '@/server/http';
import { AreaInput, AreaListQuery } from '@/schemas/lookups';
import { createArea, listAreas } from '@/server/services/lookups';

/** Lookups are public reads (the registration form needs them). */
export const GET = withPublic(async (req) => {
  const q = parseQuery(req, AreaListQuery);
  const items = await listAreas(q);
  return ok({ items, total: items.length });
});

export const POST = withAuth({ roles: ['Administrator'] }, async (req, { user }) => {
  const input = await parseBody(req, AreaInput);
  return created(await createArea(user, input));
});
