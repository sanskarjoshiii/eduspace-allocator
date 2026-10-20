import { Types } from 'mongoose';
import { Notification } from '@/server/models';
import { notFound, pageMeta } from '@/server/http';
import { toNotificationDto, type NotificationDto } from '@/server/dto/notification';
import type { SessionUser } from '@/server/auth/session';

export interface NotificationPage {
  items: NotificationDto[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  unread: number;
}

/** The user's own notifications, newest first. Administrators get theirs too (system alerts are addressed to them). */
export async function listNotifications(
  user: SessionUser,
  opts: { page: number; pageSize: number; unread: boolean },
): Promise<NotificationPage> {
  const userId = new Types.ObjectId(user.id);
  const filter: Record<string, unknown> = { userId };
  if (opts.unread) filter.isRead = false;
  const [rows, total, unread] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, isRead: false }),
  ]);
  return { items: rows.map(toNotificationDto), ...pageMeta(total, opts.page, opts.pageSize), unread };
}

export async function unreadCount(user: SessionUser): Promise<number> {
  return Notification.countDocuments({ userId: new Types.ObjectId(user.id), isRead: false });
}

/** Marks one of the user's notifications read. Someone else's notification is reported as not found. */
export async function markRead(user: SessionUser, id: Types.ObjectId): Promise<NotificationDto> {
  const doc = await Notification.findOneAndUpdate(
    { _id: id, userId: new Types.ObjectId(user.id) },
    [{ $set: { isRead: true, readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
    { new: true },
  ).lean();
  if (!doc) throw notFound('Notification');
  return toNotificationDto(doc);
}

export async function markAllRead(user: SessionUser): Promise<{ updated: number }> {
  const res = await Notification.updateMany(
    { userId: new Types.ObjectId(user.id), isRead: false },
    { $set: { isRead: true, readAt: new Date() } },
  );
  return { updated: res.modifiedCount };
}
