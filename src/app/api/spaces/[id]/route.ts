import { assertObjectId, ok, parseBody, withAuth } from '@/server/http';
import { SpaceUpdate } from '@/schemas/space';
import { deleteSpace, getSpace, updateSpace } from '@/server/services/spaces';

type P = { id: string };
const WRITERS = ['SpaceGiver', 'Administrator'] as const;

export const GET = withAuth<P>({}, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Space');
  return ok(await getSpace(user, params.id));
});

export const PATCH = withAuth<P>({ roles: WRITERS }, async (req, { user, params }) => {
  assertObjectId(params.id, 'Space');
  const input = await parseBody(req, SpaceUpdate);
  return ok(await updateSpace(user, params.id, input));
});

export const DELETE = withAuth<P>({ roles: WRITERS }, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Space');
  await deleteSpace(user, params.id);
  return ok({ id: params.id, deleted: true });
});
