import { ok, withAuth } from '@/server/http';
import { MENUS } from '@/server/auth/menu';

export const GET = withAuth({}, async (_req, { user }) => ok({ items: MENUS[user.role] }));
