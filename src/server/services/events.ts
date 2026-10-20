import type { ClientSession, Types } from 'mongoose';
import { DomainEvent } from '@/server/models';
import type { DomainEventType } from '@/lib/domain';

/**
 * Writes a domain event to the outbox. The allocation worker picks up unprocessed
 * events after the debounce window and starts one run for the whole burst.
 */
export async function emitEvent(
  type: DomainEventType,
  refId: Types.ObjectId | string | null,
  payload?: Record<string, unknown>,
  session?: ClientSession | null,
): Promise<void> {
  await DomainEvent.create([{ type, refId, payload: payload ?? null }], { session: session ?? undefined });
}
