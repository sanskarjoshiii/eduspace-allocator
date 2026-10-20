import { assertObjectId, ok, parseBody, withAuth, withPublic } from '@/server/http';
import { AreaUpdate } from '@/schemas/lookups';
import { deleteArea, getArea, updateArea } from '@/server/services/lookups';

type P = { id: string };

export const GET = withPublic<P>(async (_req, { params }) => {
  assertObjectId(params.id, 'Area');
  return ok(await getArea(params.id));
});

export const PATCH = withAuth<P>({ roles: ['Administrator'] }, async (req, { user, params }) => {
  assertObjectId(params.id, 'Area');
  const input = await parseBody(req, AreaUpdate);
  return ok(await updateArea(user, params.id, input));
});

/** 409 while anything still references it. */
export const DELETE = withAuth<P>({ roles: ['Administrator'] }, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Area');
  await deleteArea(user, params.id);
  return ok({ id: params.id, deleted: true });
});
