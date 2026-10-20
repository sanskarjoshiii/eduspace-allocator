import { Types, type ClientSession } from 'mongoose';
import { Notification, NotificationTemplate, User } from '@/server/models';
import { getSettings } from '@/server/services/settings';
import { logger } from '@/lib/logger';
import type { NotificationType, Role } from '@/lib/domain';
import { DEFAULT_TEMPLATES } from './defaults';
import { renderTemplate } from './render';
import { sendEmail } from './email';

export type TemplateVars = Record<string, string | number | null | undefined>;

export interface NotifyInput {
  type: NotificationType;
  /** User ids; each user's role picks the template. Duplicates are ignored. */
  userIds: (Types.ObjectId | string)[];
  vars: TemplateVars;
  related?: { type: string; id: Types.ObjectId | string };
  href?: string;
  session?: ClientSession | null;
}

/**
 * Renders the template for each recipient's role and stores an in-app notification.
 * Users whose role has no template for this type are skipped. Email copies go out
 * after the write, only when enabled in settings, configured, and wanted by the user;
 * an email failure never blocks the in-app notification.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const ids = [...new Set(input.userIds.map(String))].filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return 0;

  const users = await User.find({ _id: { $in: ids }, status: 'Active' })
    .select('role email name emailNotifications')
    .session(input.session ?? null)
    .lean();
  const stored = await NotificationTemplate.find({ type: input.type }).session(input.session ?? null).lean();
  const templates = new Map<Role, { titleTemplate: string; bodyTemplate: string; sendEmail: boolean }>();
  for (const t of DEFAULT_TEMPLATES.filter((d) => d.type === input.type)) {
    templates.set(t.role, { titleTemplate: t.titleTemplate, bodyTemplate: t.bodyTemplate, sendEmail: t.sendEmail ?? false });
  }
  for (const t of stored) templates.set(t.role as Role, { titleTemplate: t.titleTemplate, bodyTemplate: t.bodyTemplate, sendEmail: t.sendEmail });

  const docs: Record<string, unknown>[] = [];
  const emails: { to: string; subject: string; text: string }[] = [];
  for (const u of users) {
    const tpl = templates.get(u.role as Role);
    if (!tpl) continue;
    const vars = { recipientName: u.name, ...input.vars };
    const title = renderTemplate(tpl.titleTemplate, vars);
    const message = renderTemplate(tpl.bodyTemplate, vars);
    docs.push({
      userId: u._id,
      type: input.type,
      title,
      message,
      relatedType: input.related?.type ?? null,
      relatedId: input.related?.id ?? null,
      href: input.href ?? null,
    });
    if (tpl.sendEmail && u.emailNotifications) emails.push({ to: u.email, subject: title, text: message });
  }
  if (docs.length === 0) return 0;
  await Notification.insertMany(docs, { session: input.session ?? undefined });

  if (emails.length > 0) {
    void (async () => {
      try {
        const settings = await getSettings();
        if (!settings.emailEnabled) return;
        await Promise.all(emails.map((e) => sendEmail(e)));
      } catch (err) {
        logger.warn('notify.email_failed', { type: input.type, message: (err as Error).message });
      }
    })();
  }
  return docs.length;
}

/** All active administrators, for system alerts. */
export async function adminIds(): Promise<Types.ObjectId[]> {
  const admins = await User.find({ role: 'Administrator', status: 'Active' }).select('_id').lean();
  return admins.map((a) => a._id);
}
