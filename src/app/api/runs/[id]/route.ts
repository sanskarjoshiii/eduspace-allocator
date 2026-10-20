import { assertObjectId, ok, withAuth } from '@/server/http';
import { getRun } from '@/server/services/runs';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ id: string }>({ roles: ['Administrator'] }, async (_req, { params }) => ok(await getRun(assertObjectId(params.id, 'Run'))));
