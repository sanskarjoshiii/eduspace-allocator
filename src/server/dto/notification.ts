import type { Types } from 'mongoose';

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string | null;
  relatedType: string | null;
  relatedId: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationLean {
  _id: Types.ObjectId;
  type: string;
  title: string;
  message: string;
  href?: string | null;
  relatedType?: string | null;
  relatedId?: Types.ObjectId | null;
  isRead?: boolean | null;
  createdAt?: Date | null;
}

export function toNotificationDto(n: NotificationLean): NotificationDto {
  return {
    id: n._id.toString(),
    type: n.type,
    title: n.title,
    message: n.message,
    href: n.href ?? null,
    relatedType: n.relatedType ?? null,
    relatedId: n.relatedId ? n.relatedId.toString() : null,
    isRead: Boolean(n.isRead),
    createdAt: (n.createdAt ?? new Date(0)).toISOString(),
  };
}

export interface TemplateDto {
  type: string;
  role: string;
  titleTemplate: string;
  bodyTemplate: string;
  sendEmail: boolean;
  /** True when an Administrator override is stored; false = built-in default. */
  customised: boolean;
  /** The built-in default, for "reset" in the editor. Null for templates with no default. */
  defaultTemplate: { titleTemplate: string; bodyTemplate: string; sendEmail: boolean } | null;
  /** Placeholder names found in the title and body, e.g. ["courseTitle", "spaceName"]. */
  placeholders: string[];
  updatedAt: string | null;
}
