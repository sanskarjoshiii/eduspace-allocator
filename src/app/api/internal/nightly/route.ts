import { ok, withCron } from '@/server/http';
import { runNightly } from '@/server/worker/nightly';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 02:00 IST: re-optimise unconfirmed allocations, progress lifecycles, impact, alerts. */
const handler = withCron(async () => ok(await runNightly()));
export const GET = handler;
export const POST = handler;
