import { z } from 'zod';

/** GET /api/notifications query. */
export const NotificationListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** "1" or "true" lists unread notifications only. */
  unread: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuery>;
