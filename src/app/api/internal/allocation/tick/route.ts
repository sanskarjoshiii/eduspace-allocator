import { ok, withCron } from '@/server/http';
import { tick } from '@/server/worker/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Worker tick: recover, retry, or start a run when the outbox burst has settled. */
const handler = withCron(async () => ok(await tick()));
export const GET = handler;
export const POST = handler;
