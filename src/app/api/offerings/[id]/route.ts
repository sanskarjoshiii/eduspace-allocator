import { assertObjectId, ok, parseBody, withAuth } from '@/server/http';
import { OfferingUpdate } from '@/schemas/offering';
import { deleteOffering, getOffering, updateOffering } from '@/server/services/offerings';

type P = { id: string };
const WRITERS = ['CourseProvider', 'Administrator'] as const;

export const GET = withAuth<P>({}, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Offering');
  return ok(await getOffering(user, params.id));
});

export const PATCH = withAuth<P>({ roles: WRITERS }, async (req, { user, params }) => {
  assertObjectId(params.id, 'Offering');
  const input = await parseBody(req, OfferingUpdate);
  return ok(await updateOffering(user, params.id, input));
});

export const DELETE = withAuth<P>({ roles: WRITERS }, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Offering');
  await deleteOffering(user, params.id);
  return ok({ id: params.id, deleted: true });
});
