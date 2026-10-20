import { created, ok, parseQuery, withAuth } from '@/server/http';
import { RunListQuery, TriggerRunBody } from '@/schemas/run';
import { listRuns, triggerRun } from '@/server/services/runs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = withAuth({ roles: ['Administrator'] }, async (req) => ok(await listRuns(parseQuery(req, RunListQuery))));

/** Manual trigger: runs now, bypassing the debounce window. 409 while another run holds the lock. */
export const POST = withAuth({ roles: ['Administrator'] }, async (req, { user }) => {
  const raw: unknown = await req.json().catch(() => ({}));
  const body = TriggerRunBody.parse(raw ?? {});
  return created(await triggerRun(user, body.note));
});
