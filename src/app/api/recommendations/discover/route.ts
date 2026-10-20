import { ok, withAuth } from '@/server/http';
import { discoverFor } from '@/server/services/recommendations';

/** GET /api/recommendations/discover: Discover Courses for the signed-in learner. */
export const GET = withAuth({ roles: ['Learner'] }, async (_req, { user }) => ok(await discoverFor(user)));
