import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
vi.mock('@/server/services/alerts', () => ({ evaluateDemandAlerts: vi.fn(async () => ({ fired: 0 })) }));
vi.mock('@/server/services/engine-client', async () => {
  const { referenceEngine } = await import('@/server/worker/reference-engine');
  return { getEngine: () => referenceEngine };
});

import mongoose from 'mongoose';
import { connectDb } from '@/lib/db';
import { AllocationRun, DomainEvent, Notification, RunLock } from '@/server/models';
import { makeUser } from '../helpers/factories';
import { acquireLock, extendLock, isLocked, LOCK_ID, releaseLock } from '@/server/worker/lock';
import { outboxState } from '@/server/worker/outbox';
import { executeRun, tick } from '@/server/worker/run';
import { emitEvent } from '@/server/services/events';
import { updateSettings } from '@/server/services/settings';

beforeEach(async () => {
  await connectDb();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

describe('run lock', () => {
  it('only one holder at a time; release frees it', async () => {
    expect(await acquireLock('a', 60)).toBe(true);
    expect(await acquireLock('b', 60)).toBe(false);
    expect(await acquireLock('a', 60)).toBe(true); // re-entrant for the same holder
    expect(await isLocked()).toBe(true);
    expect(await extendLock('b', 60)).toBe(false);
    expect(await extendLock('a', 60)).toBe(true);
    await releaseLock('b'); // not the holder: no effect
    expect(await isLocked()).toBe(true);
    await releaseLock('a');
    expect(await isLocked()).toBe(false);
    expect(await acquireLock('b', 60)).toBe(true);
  });

  it('two concurrent acquisitions: exactly one wins', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => acquireLock(`h${i}`, 60)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('an expired lock is reclaimed', async () => {
    await RunLock.create({ _id: LOCK_ID, holder: 'dead-run', expiresAt: new Date(Date.now() - 1000) });
    expect(await isLocked()).toBe(false);
    expect(await acquireLock('fresh', 60)).toBe(true);
    expect((await RunLock.findById(LOCK_ID).lean())?.holder).toBe('fresh');
  });

  it('a held lock blocks runs and ticks', async () => {
    await emitEvent('manual.trigger', null);
    await updateSettings({ debounceSeconds: 0 }, null);
    await acquireLock('someone-else', 60);
    expect(await executeRun({ trigger: 'manual' })).toEqual({ outcome: 'locked' });
    expect(await tick()).toEqual({ action: 'locked' });
    expect(await AllocationRun.countDocuments()).toBe(0);
    expect(await DomainEvent.countDocuments({ processedAt: null })).toBe(1);
  });

  it('a run releases the lock when it finishes', async () => {
    await executeRun({ trigger: 'manual' });
    expect(await isLocked()).toBe(false);
  });
});

describe('outbox', () => {
  it('is ready only once the newest event is older than the debounce window', async () => {
    await emitEvent('request.saved', null);
    const now = new Date();
    expect((await outboxState(30, now)).ready).toBe(false);
    expect((await outboxState(30, new Date(now.getTime() + 31_000))).ready).toBe(true);
    expect((await outboxState(0, now)).ready).toBe(true);
  });
});

describe('interrupted runs', () => {
  it('a run that died before publish fails visibly; one that died after publish resumes', async () => {
    const admin = await makeUser('Administrator');
    await updateSettings({ maxRunRetries: 0 }, null);
    const early = await AllocationRun.create({
      trigger: 'event', status: 'Running', strategy: 'balanced', startedAt: new Date(),
      partitionState: { phase: 'engine', attempts: 1, completedPhases: ['snapshot'] },
    });
    const late = await AllocationRun.create({
      trigger: 'event', status: 'Running', strategy: 'balanced', startedAt: new Date(),
      partitionState: { phase: 'notify', attempts: 1, completedPhases: ['snapshot', 'engine', 'publish'] },
    });
    // The dead run's lock has expired.
    await RunLock.create({ _id: LOCK_ID, holder: 'dead', expiresAt: new Date(Date.now() - 1000) });
    const res = await tick();
    expect(res.action).toBe('idle');
    if (res.action === 'idle') {
      expect(res.recovered.failed).toEqual([early._id.toString()]);
      expect(res.recovered.resumed).toEqual([late._id.toString()]);
    }
    const e = await AllocationRun.findById(early._id).lean();
    expect(e?.status).toBe('Failed');
    expect(e?.error).toMatch(/engine phase/);
    expect(await Notification.countDocuments({ type: 'run.failed', userId: admin.id })).toBe(1);
    const l = await AllocationRun.findById(late._id).lean();
    expect(l?.status).toBe('Completed');
    expect(l?.partitionState?.completedPhases).toContain('done');
  });
});
