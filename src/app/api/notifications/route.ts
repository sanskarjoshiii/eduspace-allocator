import { ok, parseQuery, withAuth } from '@/server/http';
import { NotificationListQuery } from '@/schemas/notification';
import { listNotifications } from '@/server/services/notifications';

/** GET /api/notifications: the caller's own notifications, newest first. ?unread=1, ?page=, ?pageSize=. */
export const GET = withAuth({}, async (req, { user }) => {
  const q = parseQuery(req, NotificationListQuery);
  return ok(await listNotifications(user, q));
});
