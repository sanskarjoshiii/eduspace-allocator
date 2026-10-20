import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
vi.mock('@/server/services/alerts', () => ({ evaluateDemandAlerts: vi.fn(async () => ({ fired: 0 })) }));
vi.mock('@/server/services/impact', () => ({ computeImpactSnapshot: vi.fn(async () => undefined) }));
vi.mock('@/server/services/engine-client', async () => {
  const { referenceEngine } = await import('@/server/worker/reference-engine');
  return { getEngine: () => referenceEngine };
});

import mongoose from 'mongoose';
import { connectDb } from '@/lib/db';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeUser } from '../helpers/factories';
import { AllocationRun, AuditLog, DomainEvent } from '@/server/models';
import { GET as runsGET, POST as runsPOST } from '@/app/api/runs/route';
import { GET as runGET } from '@/app/api/runs/[id]/route';
import { POST as retryPOST } from '@/app/api/runs/[id]/retry/route';
import { GET as tickGET, POST as tickPOST } from '@/app/api/internal/allocation/tick/route';
import { GET as nightlyGET } from '@/app/api/internal/nightly/route';
import { GET as expireGET, POST as expirePOST } from '@/app/api/internal/offers/expire/route';
import { acquireLock, releaseLock } from '@/server/worker/lock';
import type { RunDetailDto, RunListItemDto } from '@/server/dto/run';
import type { SessionUser } from '@/server/auth/session';

let admin: SessionUser;

beforeEach(async () => {
  await connectDb();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  admin = await makeUser('Administrator');
});

const metrics = (coverageRate: number, avgDistanceKm: number) => ({
  requests: 10, assigned: 7, waitlisted: 1, unmatched: 2, allocations: 2, coverageRate, avgDistanceKm, seatUtilisation: 0.7,
  spaceUtilisationHours: 4, avgScore: 0.7, waitlistRate: 0.1, optimisationScore: 0.6, runTimeMs: 12,
});

describe('runs API', () => {
  it('admin can trigger a run, list runs and read details with the baseline comparison', async () => {
    actAs(admin);
    const trig = await json<RunDetailDto>(await runsPOST(req('POST', '/api/runs', { note: 'after import' }), ctx()));
    expect(trig.status).toBe(201);
    expect(trig.data.status).toBe('Completed');
    expect(trig.data.trigger).toBe('manual');
    expect(await DomainEvent.countDocuments({ type: 'manual.trigger', processedAt: { $ne: null } })).toBe(1);

    const run = await AllocationRun.create({
      trigger: 'event', status: 'Completed', strategy: 'balanced', startedAt: new Date(Date.now() - 2000), finishedAt: new Date(),
      metrics: metrics(0.7, 2.1), baselineMetrics: metrics(0.5, 3.4), decisionSummary: 'Summary', counts: { seated: 7 },
    });
    const list = await json<{ items: RunListItemDto[]; meta: { total: number } }>(await runsGET(req('GET', '/api/runs?page=1&pageSize=10'), ctx()));
    expect(list.data.meta.total).toBe(2);
    expect(list.data.items[0]).toMatchObject({ id: run._id.toString(), coverageRate: 0.7, durationMs: expect.any(Number) });

    const detail = await json<RunDetailDto>(await runGET(req('GET', '/x'), ctx({ id: run._id.toString() })));
    const coverage = detail.data.comparison.find((c) => c.metric === 'coverageRate');
    expect(coverage).toMatchObject({ optimised: 0.7, baseline: 0.5, better: true });
    expect(coverage!.delta).toBeCloseTo(0.2);
    expect(detail.data.comparison.find((c) => c.metric === 'avgDistanceKm')?.better).toBe(true);
    expect(detail.data.decisionSummary).toBe('Summary');
  });

  it('is Administrator only', async () => {
    actAs(await makeUser('CourseProvider'));
    expect((await runsGET(req('GET', '/api/runs'), ctx())).status).toBe(403);
    expect((await runsPOST(req('POST', '/api/runs', {}), ctx())).status).toBe(403);
    actAs(null);
    expect((await runsGET(req('GET', '/api/runs'), ctx())).status).toBe(401);
  });

  it('returns 409 while another run holds the lock', async () => {
    await acquireLock('busy', 60);
    actAs(admin);
    expect((await runsPOST(req('POST', '/api/runs', {}), ctx())).status).toBe(409);
    await releaseLock('busy');
  });

  it('retries a failed run, and refuses to retry anything else', async () => {
    const failed = await AllocationRun.create({ trigger: 'event', status: 'Failed', strategy: 'balanced', error: 'boom' });
    actAs(admin);
    const res = await json<RunDetailDto>(await retryPOST(req('POST', '/x'), ctx({ id: failed._id.toString() })));
    expect(res.status).toBe(201);
    expect(res.data.retryOf).toBe(failed._id.toString());
    expect(res.data.attempts).toBe(2);
    expect(await AuditLog.countDocuments({ entity: 'AllocationRun', actorId: admin.id })).toBe(1);
    expect((await retryPOST(req('POST', '/x'), ctx({ id: res.data.id }))).status).toBe(409);
  });
});

describe('internal cron endpoints', () => {
  const auth = { authorization: `Bearer ${process.env.CRON_SECRET}` };

  it('require the cron secret', async () => {
    expect((await tickGET(req('GET', '/api/internal/allocation/tick'))).status).toBe(401);
    expect((await tickGET(req('GET', '/api/internal/allocation/tick', undefined, { authorization: 'Bearer wrong' }))).status).toBe(401);
  });

  it('accept GET (Vercel Cron) and POST', async () => {
    const t1 = await json<{ action: string }>(await tickGET(req('GET', '/api/internal/allocation/tick', undefined, auth)));
    expect(t1.status).toBe(200);
    expect(t1.data.action).toBe('idle');
    expect((await tickPOST(req('POST', '/api/internal/allocation/tick', undefined, auth))).status).toBe(200);
    const exp = await json<{ expired: number; reminded: number }>(await expireGET(req('GET', '/api/internal/offers/expire', undefined, auth)));
    expect(exp.data).toEqual({ expired: 0, reminded: 0 });
    expect((await expirePOST(req('POST', '/api/internal/offers/expire', undefined, auth))).status).toBe(200);
    const nightly = await json<{ run: { outcome: string } }>(await nightlyGET(req('GET', '/api/internal/nightly', undefined, auth)));
    expect(nightly.status).toBe(200);
    expect(nightly.data.run.outcome).toBe('completed');
    expect(await AllocationRun.countDocuments({ trigger: 'nightly' })).toBe(1);
  });
});
