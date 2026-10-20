import { z } from 'zod';
import { RUN_STATUSES, RUN_TRIGGERS } from '@/lib/domain';

/** GET /api/runs. */
export const RunListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(RUN_STATUSES).optional(),
  trigger: z.enum(RUN_TRIGGERS).optional(),
});
export type RunListQuery = z.infer<typeof RunListQuery>;

/** POST /api/runs (manual trigger). The note is stored on the manual.trigger event. */
export const TriggerRunBody = z.object({
  note: z.string().trim().max(500).optional(),
});
export type TriggerRunBody = z.infer<typeof TriggerRunBody>;
