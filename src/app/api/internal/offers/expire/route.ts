import { ok, withCron } from '@/server/http';
import { runOfferJobs } from '@/server/services/enrollments';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Hourly: expire overdue offers (promoting the waitlist) and send expiring reminders. */
const handler = withCron(async () => ok(await runOfferJobs()));
export const GET = handler;
export const POST = handler;
