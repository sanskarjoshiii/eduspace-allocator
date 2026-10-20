import { ok, withPublic } from '@/server/http';
import { allLookups } from '@/server/services/lookups';

/** Facility types, categories and areas in one call, for forms. */
export const GET = withPublic(async () => ok(await allLookups()));
