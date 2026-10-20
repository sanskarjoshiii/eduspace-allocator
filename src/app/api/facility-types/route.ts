import { created, ok, parseBody, withAuth, withPublic } from '@/server/http';
import { FacilityTypeInput } from '@/schemas/lookups';
import { createFacilityType, listFacilityTypes } from '@/server/services/lookups';

/** Lookups are public reads (the registration form needs them). */
export const GET = withPublic(async () => {
  const items = await listFacilityTypes();
  return ok({ items, total: items.length });
});

export const POST = withAuth({ roles: ['Administrator'] }, async (req, { user }) => {
  const input = await parseBody(req, FacilityTypeInput);
  return created(await createFacilityType(user, input));
});
