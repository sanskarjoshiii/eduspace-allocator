import { z } from 'zod';
import { ok, parseQuery, withAuth } from '@/server/http';
import { ObjectIdString } from '@/schemas/common';
import { analyticsFor } from '@/server/services/analytics';

const Query = z.object({
  scope: z.enum(['global', 'SpaceGiver', 'CourseProvider']).optional(),
  ownerId: ObjectIdString.optional(),
});

/** GET /api/analytics: Administrator global (or ?scope=&ownerId=), Space Giver own spaces, Course Provider own courses. */
export const GET = withAuth({ roles: ['Administrator', 'SpaceGiver', 'CourseProvider'] }, async (req, { user }) => {
  return ok(await analyticsFor(user, parseQuery(req, Query)));
});
