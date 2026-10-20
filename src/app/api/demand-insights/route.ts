import { z } from 'zod';
import { ok, parseQuery, withAuth } from '@/server/http';
import { DEMAND_LEVELS } from '@/lib/domain';
import { ObjectIdString } from '@/schemas/common';
import { listInsights } from '@/server/services/insights';

const Query = z.object({
  areaId: ObjectIdString.optional(),
  categoryId: ObjectIdString.optional(),
  level: z.enum(DEMAND_LEVELS).optional(),
});

/** GET /api/demand-insights: aggregated demand by area and category, every role. Learners get their own area first. */
export const GET = withAuth({}, async (req, { user }) => ok(await listInsights(user, parseQuery(req, Query))));
