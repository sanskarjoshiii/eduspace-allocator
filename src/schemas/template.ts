import { z } from 'zod';
import { NOTIFICATION_TYPES, ROLES } from '@/lib/domain';

/** PATCH /api/notification-templates: upsert one template override. */
export const TemplateUpsertInput = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  role: z.enum(ROLES),
  titleTemplate: z.string().trim().min(1, 'Title is required').max(200),
  bodyTemplate: z.string().trim().min(1, 'Message is required').max(2000),
  sendEmail: z.boolean().default(false),
});
export type TemplateUpsertInput = z.infer<typeof TemplateUpsertInput>;
