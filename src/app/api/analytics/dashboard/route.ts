import { ok, withAuth } from '@/server/http';
import { dashboardFor } from '@/server/services/analytics';

/** GET /api/analytics/dashboard: every widget the caller's role dashboard needs, in one call. */
export const GET = withAuth({}, async (_req, { user }) => ok(await dashboardFor(user)));
