import { Types } from 'mongoose';
import { ok, parseQuery, withAuth } from '@/server/http';
import { RosterQuery } from '@/schemas/enrollment';
import { listRoster } from '@/server/services/enrollments';

export const dynamic = 'force-dynamic';

/** Roster of an allocation, redacted by stage (provider, space giver, admin). */
export const GET = withAuth({ roles: ['CourseProvider', 'SpaceGiver', 'Administrator'] }, async (req, { user }) => {
  const q = parseQuery(req, RosterQuery);
  return ok(await listRoster(user, new Types.ObjectId(q.allocationId)));
});
