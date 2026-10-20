import { ok, parseQuery, withAuth } from '@/server/http';
import { AllocationListQuery } from '@/schemas/allocation';
import { listAllocations } from '@/server/services/allocations';

export const dynamic = 'force-dynamic';

/** Role-scoped allocation list. */
export const GET = withAuth({}, async (req, { user }) => {
  const q = parseQuery(req, AllocationListQuery);
  return ok(await listAllocations(user, q));
});
