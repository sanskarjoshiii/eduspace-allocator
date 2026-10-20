import { ok, withAuth } from '@/server/http';
import { getImpact } from '@/server/services/impact';

/** GET /api/impact: latest Social Impact snapshot plus monthly history. Every signed-in role. */
export const GET = withAuth({}, async () => ok(await getImpact()));
