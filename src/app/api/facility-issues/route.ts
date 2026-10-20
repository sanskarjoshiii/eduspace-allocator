import { created, ok, parseBody, parseQuery, withAuth } from '@/server/http';
import { FacilityIssueInput, FacilityIssueListQuery } from '@/schemas/facility-issue';
import { listFacilityIssues, reportFacilityIssue } from '@/server/services/facility-issues';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withAuth({ roles: ['SpaceGiver', 'CourseProvider', 'Administrator'] }, async (req, { user }) => {
  return ok(await listFacilityIssues(user, parseQuery(req, FacilityIssueListQuery)));
});

export const POST = withAuth({ roles: ['SpaceGiver', 'Administrator'] }, async (req, { user }) => {
  const body = await parseBody(req, FacilityIssueInput);
  return created(await reportFacilityIssue(user, body));
});
