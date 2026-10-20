import { Types } from 'mongoose';
import { z } from 'zod';
import { ok, parseQuery, withAuth } from '@/server/http';
import { ObjectIdString } from '@/schemas/common';
import { recommendationsFor } from '@/server/services/recommendations';

const Query = z.object({ requestId: ObjectIdString });

/** GET /api/recommendations?requestId=: top suggestions with reasons. The request keeps its status. */
export const GET = withAuth({ roles: ['Learner', 'Administrator'] }, async (req, { user }) => {
  const { requestId } = parseQuery(req, Query);
  return ok(await recommendationsFor(user, new Types.ObjectId(requestId)));
});
