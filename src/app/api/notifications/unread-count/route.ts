import { ok, withAuth } from '@/server/http';
import { unreadCount } from '@/server/services/notifications';

/** GET /api/notifications/unread-count: { count } for the bell (polled). */
export const GET = withAuth({}, async (_req, { user }) => ok({ count: await unreadCount(user) }));
