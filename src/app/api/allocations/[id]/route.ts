import { assertObjectId, ok, withAuth } from '@/server/http';
import { getAllocationDetail } from '@/server/services/allocations';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ id: string }>({}, async (_req, { user, params }) => {
  return ok(await getAllocationDetail(user, assertObjectId(params.id, 'Allocation')));
});
