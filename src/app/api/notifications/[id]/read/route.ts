import { assertObjectId, ok, withAuth } from '@/server/http';
import { markRead } from '@/server/services/notifications';

/** POST /api/notifications/:id/read: marks one of the caller's notifications read. */
export const POST = withAuth<{ id: string }>({}, async (_req, { user, params }) => {
  return ok(await markRead(user, assertObjectId(params.id, 'Notification')));
});
