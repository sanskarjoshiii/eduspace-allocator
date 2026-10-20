import { assertObjectId, ok, parseBody, withAuth } from '@/server/http';
import { AllocationOverrideBody } from '@/schemas/allocation';
import { getAllocationDetail, overrideAllocation } from '@/server/services/allocations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Administrator override: approve, confirm, reject, cancel or move. Audited with the note. */
export const POST = withAuth<{ id: string }>({ roles: ['Administrator'] }, async (req, { user, params }) => {
  const id = assertObjectId(params.id, 'Allocation');
  const body = await parseBody(req, AllocationOverrideBody);
  await overrideAllocation(user, id, body);
  return ok(await getAllocationDetail(user, id));
});
