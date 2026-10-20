import { ok, withAuth } from '@/server/http';
import { getSdg } from '@/server/services/impact';

/** GET /api/sdg: the six SDGs with their indicators. Every signed-in role. */
export const GET = withAuth({}, async () => ok(await getSdg()));
