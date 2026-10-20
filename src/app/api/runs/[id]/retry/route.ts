import { assertObjectId, created, withAuth } from '@/server/http';
import { retryRun } from '@/server/services/runs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = withAuth<{ id: string }>({ roles: ['Administrator'] }, async (_req, { user, params }) => {
  return created(await retryRun(user, assertObjectId(params.id, 'Run')));
});
