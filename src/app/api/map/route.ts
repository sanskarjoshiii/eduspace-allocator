import { ok, parseQuery, withAuth } from '@/server/http';
import { MapQuery } from '@/schemas/map';
import { getMap } from '@/server/services/map';

/** GET /api/map?layers=&categoryId=&level=&availableOnly=1: role-scoped map layers. */
export const GET = withAuth({}, async (req, { user }) => ok(await getMap(user, parseQuery(req, MapQuery))));
