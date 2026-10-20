import { z } from 'zod';
import { ok, parseQuery, withAuth } from '@/server/http';
import { DEMAND_LEVELS } from '@/lib/domain';
import { ObjectIdString } from '@/schemas/common';
import { areaTotals } from '@/server/services/insights';

const Query = z.object({ categoryId: ObjectIdString.optional(), level: z.enum(DEMAND_LEVELS).optional() });

/** GET /api/demand-insights/areas: per-area totals with demand level, for heatmaps. */
export const GET = withAuth({}, async (req) => ok({ items: await areaTotals(parseQuery(req, Query)) }));
