import { ok, withAuth } from '@/server/http';
import { markAllRead } from '@/server/services/notifications';

/** POST /api/notifications/read-all: marks every unread notification of the caller read. */
export const POST = withAuth({}, async (_req, { user }) => ok(await markAllRead(user)));
