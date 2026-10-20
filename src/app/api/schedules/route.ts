import { ok, parseQuery, withAuth } from '@/server/http';
import { ScheduleQuery } from '@/schemas/allocation';
import { listSchedules } from '@/server/services/scheduling';

export const dynamic = 'force-dynamic';

/** ?allocationId= | ?mine=1 | (admin) ?spaceId=&from=YYYY-MM-DD&to=YYYY-MM-DD */
export const GET = withAuth({}, async (req, { user }) => {
  const q = parseQuery(req, ScheduleQuery);
  return ok(await listSchedules(user, q));
});
