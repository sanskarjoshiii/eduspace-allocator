import { assertObjectId, ok, withAuth } from '@/server/http';
import { getFacilityIssue } from '@/server/services/facility-issues';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ id: string }>({ roles: ['SpaceGiver', 'CourseProvider', 'Administrator'] }, async (_req, { user, params }) => {
  return ok(await getFacilityIssue(user, assertObjectId(params.id, 'Facility issue')));
});
