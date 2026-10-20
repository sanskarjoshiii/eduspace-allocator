import { assertObjectId, ok, parseBody, withAuth } from '@/server/http';
import { CategoryUpdate } from '@/schemas/lookups';
import { deleteCategory, updateCategory } from '@/server/services/lookups';

type P = { id: string };

export const PATCH = withAuth<P>({ roles: ['Administrator'] }, async (req, { user, params }) => {
  assertObjectId(params.id, 'Category');
  const input = await parseBody(req, CategoryUpdate);
  return ok(await updateCategory(user, params.id, input));
});

/** 409 while anything still references it. */
export const DELETE = withAuth<P>({ roles: ['Administrator'] }, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Category');
  await deleteCategory(user, params.id);
  return ok({ id: params.id, deleted: true });
});
