import { z } from 'zod';
import { DEMAND_LEVELS } from '@/lib/domain';
import { ObjectIdString } from './common';

export const MAP_LAYERS = ['spaces', 'allocations', 'demand', 'offers', 'unused'] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/** GET /api/map query. `layers` is a comma-separated list; omitted = every layer the role may see. */
export const MapQuery = z.object({
  layers: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return [...MAP_LAYERS] as MapLayer[];
      const parts = [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
      const bad = parts.filter((p) => !(MAP_LAYERS as readonly string[]).includes(p));
      if (bad.length) {
        ctx.addIssue({ code: 'custom', message: `Unknown layer: ${bad.join(', ')}` });
        return z.NEVER;
      }
      return parts as MapLayer[];
    }),
  categoryId: ObjectIdString.optional(),
  level: z.enum(DEMAND_LEVELS).optional(),
  availableOnly: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});
export type MapQuery = z.infer<typeof MapQuery>;
