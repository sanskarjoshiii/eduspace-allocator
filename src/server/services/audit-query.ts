import { Types } from 'mongoose';
import { AuditLog, User } from '@/server/models';
import { forbidden, pageMeta } from '@/server/http';
import { toAuditDto, type AuditLogDto } from '@/server/dto/audit';
import type { SessionUser } from '@/server/auth/session';

export interface AuditQueryInput {
  page: number;
  pageSize: number;
  entity?: string;
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
}

export interface AuditPage {
  items: AuditLogDto[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

/**
 * Audit entries, newest first. Administrators see everything. Space Givers and Course
 * Providers see their own activity: entries they made or entries about records they own.
 */
export async function listAuditLogs(user: SessionUser, q: AuditQueryInput): Promise<AuditPage> {
  if (user.role === 'Learner') throw forbidden();
  const and: Record<string, unknown>[] = [];
  if (user.role !== 'Administrator') {
    if (q.actorId && q.actorId !== user.id) throw forbidden('You can only see your own activity.');
    const me = new Types.ObjectId(user.id);
    and.push({ $or: [{ actorId: me }, { ownerUserId: me }] });
  }
  if (q.entity) and.push({ entity: q.entity });
  if (q.action) and.push({ action: q.action });
  if (q.actorId) and.push({ actorId: new Types.ObjectId(q.actorId) });
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = q.from;
    if (q.to) range.$lte = q.to;
    and.push({ createdAt: range });
  }
  const filter = and.length ? { $and: and } : {};
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    AuditLog.countDocuments(filter),
  ]);
  const actors = await User.find({ _id: { $in: rows.map((r) => r.actorId).filter(Boolean) } }).select('name').lean();
  const names = new Map(actors.map((a) => [a._id.toString(), a.name]));
  return {
    items: rows.map((r) => toAuditDto(r, r.actorId ? names.get(r.actorId.toString()) ?? null : null)),
    ...pageMeta(total, q.page, q.pageSize),
  };
}

/** Distinct entity and action names, for the filter dropdowns. Scoped like the list. */
export async function auditFacets(user: SessionUser): Promise<{ entities: string[]; actions: string[] }> {
  if (user.role === 'Learner') throw forbidden();
  const me = new Types.ObjectId(user.id);
  const filter = user.role === 'Administrator' ? {} : { $or: [{ actorId: me }, { ownerUserId: me }] };
  const [entities, actions] = await Promise.all([AuditLog.distinct('entity', filter), AuditLog.distinct('action', filter)]);
  return { entities: (entities as string[]).sort(), actions: (actions as string[]).sort() };
}
