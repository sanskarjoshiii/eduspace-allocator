import { NotificationTemplate } from '@/server/models';
import { DEFAULT_TEMPLATES } from '@/server/notifications/defaults';
import { NOTIFICATION_TYPES, ROLES } from '@/lib/domain';
import { audit } from './audit';
import type { TemplateDto } from '@/server/dto/notification';
import type { TemplateUpsertInput } from '@/schemas/template';
import type { SessionUser } from '@/server/auth/session';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Placeholder names used in a set of template strings, in first-seen order. */
export function placeholdersOf(...templates: string[]): string[] {
  const out: string[] = [];
  for (const t of templates) for (const m of t.matchAll(PLACEHOLDER)) if (m[1] && !out.includes(m[1])) out.push(m[1]);
  return out;
}

const key = (type: string, role: string) => `${type}|${role}`;
const typeOrder = (t: string) => (NOTIFICATION_TYPES as readonly string[]).indexOf(t);
const roleOrder = (r: string) => (ROLES as readonly string[]).indexOf(r);

/** Built-in defaults merged with stored overrides, one row per (type, role). */
export async function listTemplates(): Promise<TemplateDto[]> {
  const stored = await NotificationTemplate.find().lean();
  const rows = new Map<string, TemplateDto>();
  for (const d of DEFAULT_TEMPLATES) {
    const def = { titleTemplate: d.titleTemplate, bodyTemplate: d.bodyTemplate, sendEmail: d.sendEmail ?? false };
    rows.set(key(d.type, d.role), {
      type: d.type,
      role: d.role,
      ...def,
      customised: false,
      defaultTemplate: def,
      placeholders: placeholdersOf(d.titleTemplate, d.bodyTemplate),
      updatedAt: null,
    });
  }
  for (const s of stored) {
    const existing = rows.get(key(s.type, s.role));
    rows.set(key(s.type, s.role), {
      type: s.type,
      role: s.role,
      titleTemplate: s.titleTemplate,
      bodyTemplate: s.bodyTemplate,
      sendEmail: s.sendEmail,
      customised: true,
      defaultTemplate: existing?.defaultTemplate ?? null,
      placeholders: placeholdersOf(s.titleTemplate, s.bodyTemplate),
      updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
    });
  }
  return [...rows.values()].sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || roleOrder(a.role) - roleOrder(b.role));
}

/** Stores an override for (type, role). New notifications use it immediately; no redeploy. */
export async function upsertTemplate(actor: SessionUser, input: TemplateUpsertInput): Promise<TemplateDto> {
  const before = await NotificationTemplate.findOne({ type: input.type, role: input.role }).lean();
  const doc = await NotificationTemplate.findOneAndUpdate(
    { type: input.type, role: input.role },
    { $set: { titleTemplate: input.titleTemplate, bodyTemplate: input.bodyTemplate, sendEmail: input.sendEmail } },
    { upsert: true, new: true, runValidators: true },
  ).lean();
  await audit({
    actor,
    action: before ? 'update' : 'create',
    entity: 'NotificationTemplate',
    entityId: doc?._id ?? null,
    diff: {
      type: input.type,
      role: input.role,
      before: before ? { titleTemplate: before.titleTemplate, bodyTemplate: before.bodyTemplate, sendEmail: before.sendEmail } : null,
      after: { titleTemplate: input.titleTemplate, bodyTemplate: input.bodyTemplate, sendEmail: input.sendEmail },
    },
  });
  const all = await listTemplates();
  return all.find((t) => t.type === input.type && t.role === input.role)!;
}
