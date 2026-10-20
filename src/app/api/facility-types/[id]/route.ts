import { assertObjectId, ok, parseBody, withAuth } from '@/server/http';
import { FacilityTypeUpdate } from '@/schemas/lookups';
import { deleteFacilityType, updateFacilityType } from '@/server/services/lookups';

type P = { id: string };

export const PATCH = withAuth<P>({ roles: ['Administrator'] }, async (req, { user, params }) => {
  assertObjectId(params.id, 'Facility type');
  const input = await parseBody(req, FacilityTypeUpdate);
  return ok(await updateFacilityType(user, params.id, input));
});

/** 409 while anything still references it. */
export const DELETE = withAuth<P>({ roles: ['Administrator'] }, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Facility type');
  await deleteFacilityType(user, params.id);
  return ok({ id: params.id, deleted: true });
});
