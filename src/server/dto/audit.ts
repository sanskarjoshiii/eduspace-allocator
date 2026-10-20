import type { Types } from 'mongoose';

export interface AuditLogDto {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actor: { id: string | null; name: string; role: string };
  ownerUserId: string | null;
  diff: unknown;
  createdAt: string;
}

interface AuditLean {
  _id: Types.ObjectId;
  actorId?: Types.ObjectId | null;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId?: Types.ObjectId | null;
  ownerUserId?: Types.ObjectId | null;
  diff?: unknown;
  createdAt?: Date | null;
}

const SECRET = /pass(word)?|secret|token|hash/i;

/** Drops secret-looking keys from a stored diff before it leaves the server. */
function scrubDiff(diff: unknown): unknown {
  if (!diff || typeof diff !== 'object') return diff ?? null;
  if (Array.isArray(diff)) return diff.map(scrubDiff);
  return Object.fromEntries(
    Object.entries(diff as Record<string, unknown>).map(([k, v]) => [k, SECRET.test(k) ? '[redacted]' : scrubDiff(v)]),
  );
}

export function toAuditDto(a: AuditLean, actorName: string | null): AuditLogDto {
  const role = a.actorRole ?? 'System';
  return {
    id: a._id.toString(),
    action: a.action,
    entity: a.entity,
    entityId: a.entityId ? a.entityId.toString() : null,
    actor: { id: a.actorId ? a.actorId.toString() : null, name: actorName ?? (a.actorId ? 'Removed user' : 'System'), role },
    ownerUserId: a.ownerUserId ? a.ownerUserId.toString() : null,
    diff: scrubDiff(a.diff),
    createdAt: (a.createdAt ?? new Date(0)).toISOString(),
  };
}
