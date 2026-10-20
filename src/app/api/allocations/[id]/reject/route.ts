import { assertObjectId, ok, withAuth } from '@/server/http';
import { AllocationActionBody } from '@/schemas/allocation';
import { rejectAllocation, getAllocationDetail } from '@/server/services/allocations';

export const dynamic = 'force-dynamic';

/** Body is optional: { note?: string }. */
export const POST = withAuth<{ id: string }>({ roles: ['SpaceGiver', 'Administrator'] }, async (req, { user, params }) => {
  const id = assertObjectId(params.id, 'Allocation');
  const raw: unknown = await req.json().catch(() => ({}));
  const body = AllocationActionBody.parse(raw ?? {});
  await rejectAllocation(user, id, body.note);
  return ok(await getAllocationDetail(user, id));
});
