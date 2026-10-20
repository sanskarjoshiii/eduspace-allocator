import { z } from 'zod';
import { ok, parseQuery, withAuth } from '@/server/http';
import { ObjectIdString } from '@/schemas/common';
import { auditFacets, listAuditLogs } from '@/server/services/audit-query';

const Query = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(25),
    entity: z.string().trim().max(60).optional(),
    action: z.string().trim().max(60).optional(),
    actorId: ObjectIdString.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    facets: z.enum(['0', '1']).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'Start date must be before end date', path: ['from'] });

/** GET /api/audit-logs: Administrator all; Space Giver and Course Provider own activity. ?facets=1 adds filter options. */
export const GET = withAuth({ roles: ['Administrator', 'SpaceGiver', 'CourseProvider'] }, async (req, { user }) => {
  const q = parseQuery(req, Query);
  const page = await listAuditLogs(user, q);
  return ok(q.facets === '1' ? { ...page, facets: await auditFacets(user) } : page);
});
