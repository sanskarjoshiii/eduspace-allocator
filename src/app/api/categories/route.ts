import { created, ok, parseBody, parseQuery, withAuth, withPublic } from '@/server/http';
import { CategoryInput, CategoryListQuery } from '@/schemas/lookups';
import { createCategory, listCategories } from '@/server/services/lookups';

/** Lookups are public reads (the registration form needs them). */
export const GET = withPublic(async (req) => {
  const q = parseQuery(req, CategoryListQuery);
  const items = await listCategories(q);
  return ok({ items, total: items.length });
});

export const POST = withAuth({ roles: ['Administrator'] }, async (req, { user }) => {
  const input = await parseBody(req, CategoryInput);
  return created(await createCategory(user, input));
});
