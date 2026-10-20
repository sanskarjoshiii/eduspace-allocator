import type { Types } from 'mongoose';
import { DomainEvent } from '@/server/models';

export interface OutboxState {
  /** Unprocessed events. */
  pending: number;
  newestAt: Date | null;
  /** True when events exist and the newest is older than the debounce window. */
  ready: boolean;
  /** Seconds left before the burst settles (0 when ready or empty). */
  waitSeconds: number;
}

/** Reads the outbox: a burst of events becomes ready once it has been quiet for `debounceSeconds`. */
export async function outboxState(debounceSeconds: number, now: Date = new Date()): Promise<OutboxState> {
  const pending = await DomainEvent.countDocuments({ processedAt: null });
  if (pending === 0) return { pending: 0, newestAt: null, ready: false, waitSeconds: 0 };
  const newest = await DomainEvent.findOne({ processedAt: null }).sort({ createdAt: -1 }).select('createdAt').lean<{ createdAt: Date }>();
  const newestAt = newest?.createdAt ?? null;
  const ageMs = newestAt ? now.getTime() - newestAt.getTime() : Infinity;
  const ready = ageMs >= debounceSeconds * 1000;
  return { pending, newestAt, ready, waitSeconds: ready ? 0 : Math.ceil((debounceSeconds * 1000 - ageMs) / 1000) };
}

/** Ids of every unprocessed event created up to `until`; a run claims these. */
export async function pendingEventIds(until: Date = new Date()): Promise<Types.ObjectId[]> {
  const docs = await DomainEvent.find({ processedAt: null, createdAt: { $lte: until } }).select('_id').lean();
  return docs.map((d) => d._id);
}
