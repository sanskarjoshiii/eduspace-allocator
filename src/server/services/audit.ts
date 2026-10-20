import type { ClientSession, Types } from 'mongoose';
import { AuditLog } from '@/server/models';
import { logger } from '@/lib/logger';
import type { SessionUser } from '@/server/auth/session';

export interface AuditInput {
  /** The acting user, or null for system actors (worker, cron). */
  actor: SessionUser | null;
  action: 'create' | 'update' | 'delete' | 'approve' | 'confirm' | 'override' | 'accept' | 'decline' | 'engine' | 'login' | string;
  entity: string;
  entityId?: Types.ObjectId | string | null;
  ownerUserId?: Types.ObjectId | string | null;
  diff?: unknown;
  session?: ClientSession | null;
}

/** Writes an audit entry. Never throws: a failed audit write is logged, not surfaced. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await AuditLog.create(
      [
        {
          actorId: input.actor?.id ?? null,
          actorRole: input.actor?.role ?? 'System',
          action: input.action,
          entity: input.entity,
          entityId: input.entityId ?? null,
          ownerUserId: input.ownerUserId ?? input.actor?.id ?? null,
          diff: input.diff ?? null,
        },
      ],
      { session: input.session ?? undefined },
    );
  } catch (err) {
    logger.error('audit.write_failed', { entity: input.entity, action: input.action, message: (err as Error).message });
  }
}

/** Shallow before/after diff of the changed keys, for audit entries. */
export function diffOf(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) out[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }
  return out;
}
