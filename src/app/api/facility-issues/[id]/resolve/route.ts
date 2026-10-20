import { assertObjectId, ok, withAuth } from '@/server/http';
import { FacilityIssueResolveBody } from '@/schemas/facility-issue';
import { resolveFacilityIssue } from '@/server/services/facility-issues';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Body is optional: { note?: string }. */
export const POST = withAuth<{ id: string }>({ roles: ['SpaceGiver', 'Administrator'] }, async (req, { user, params }) => {
  const id = assertObjectId(params.id, 'Facility issue');
  const raw: unknown = await req.json().catch(() => ({}));
  const body = FacilityIssueResolveBody.parse(raw ?? {});
  return ok(await resolveFacilityIssue(user, id, body.note));
});
