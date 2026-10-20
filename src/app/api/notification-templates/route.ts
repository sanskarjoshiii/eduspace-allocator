import { ok, parseBody, withAuth } from '@/server/http';
import { TemplateUpsertInput } from '@/schemas/template';
import { listTemplates, upsertTemplate } from '@/server/services/templates';

/** GET /api/notification-templates: defaults merged with stored overrides, with placeholders. */
export const GET = withAuth({ roles: ['Administrator'] }, async () => ok({ items: await listTemplates() }));

/** PATCH /api/notification-templates: upsert one (type, role) template. Takes effect on the next notification. */
export const PATCH = withAuth({ roles: ['Administrator'] }, async (req, { user }) => {
  const input = await parseBody(req, TemplateUpsertInput);
  return ok(await upsertTemplate(user, input));
});
