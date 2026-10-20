import { ok, withPublic } from '@/server/http';
import { getPublicImpact } from '@/server/services/impact';

/** GET /api/public/impact: headline impact numbers, no sign-in, no personal data. */
export const GET = withPublic(async () => ok(await getPublicImpact(), { headers: { 'cache-control': 'public, max-age=300' } }));
