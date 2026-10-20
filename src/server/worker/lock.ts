import { randomUUID } from 'node:crypto';
import { RunLock } from '@/server/models';

/** The single lock document guarding allocation runs. */
export const LOCK_ID = 'allocation';

export const newHolderId = (): string => `run-${randomUUID()}`;

/**
 * Takes the run lock when it is free (missing or expired) or already ours. A live lock
 * held by someone else makes the upsert collide on _id, which means "not acquired".
 */
export async function acquireLock(holder: string, ttlSeconds: number, now: Date = new Date()): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  try {
    const doc = await RunLock.findOneAndUpdate(
      { _id: LOCK_ID, $or: [{ expiresAt: { $lt: now } }, { holder }] },
      { $set: { holder, expiresAt } },
      { upsert: true, new: true },
    ).lean();
    return doc?.holder === holder;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

/** Pushes the expiry forward while a long run is still working. */
export async function extendLock(holder: string, ttlSeconds: number): Promise<boolean> {
  const res = await RunLock.updateOne({ _id: LOCK_ID, holder }, { $set: { expiresAt: new Date(Date.now() + ttlSeconds * 1000) } });
  return res.matchedCount === 1;
}

export async function releaseLock(holder: string): Promise<void> {
  await RunLock.deleteOne({ _id: LOCK_ID, holder });
}

/** True when an unexpired lock exists (a run is in progress). */
export async function isLocked(now: Date = new Date()): Promise<boolean> {
  const lock = await RunLock.findById(LOCK_ID).lean();
  return Boolean(lock && lock.expiresAt > now);
}
