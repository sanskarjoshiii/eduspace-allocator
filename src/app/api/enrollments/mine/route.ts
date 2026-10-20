import { ok, withAuth } from '@/server/http';
import { listMyEnrollments } from '@/server/services/enrollments';

export const dynamic = 'force-dynamic';

export const GET = withAuth({ roles: ['Learner'] }, async (_req, { user }) => ok(await listMyEnrollments(user)));
