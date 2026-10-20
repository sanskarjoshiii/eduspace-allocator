import { z } from 'zod';
import { INCOME_GROUPS } from '@/lib/domain';
import { ObjectIdString, PointInput } from './common';

const Name = z.string().trim().min(2, 'Enter a name').max(80);

/** POST /api/facility-types (Administrator). */
export const FacilityTypeInput = z.object({
  name: Name,
  unit: z.string().trim().min(1).max(30).optional(),
  description: z.string().trim().max(500).optional(),
});
export type FacilityTypeInput = z.infer<typeof FacilityTypeInput>;
export const FacilityTypeUpdate = FacilityTypeInput.partial();
export type FacilityTypeUpdate = z.infer<typeof FacilityTypeUpdate>;

/** POST /api/categories (Administrator). parentId groups similar categories. */
export const CategoryInput = z.object({
  name: Name,
  parentId: ObjectIdString.nullable().optional(),
});
export type CategoryInput = z.infer<typeof CategoryInput>;
export const CategoryUpdate = CategoryInput.partial();
export type CategoryUpdate = z.infer<typeof CategoryUpdate>;

/** POST /api/areas (Administrator). Centre is GeoJSON [lng, lat]. */
export const AreaInput = z.object({
  name: Name,
  city: z.string().trim().min(1).max(80).optional(),
  center: PointInput,
  population: z.number().int().min(0),
  studentCount: z.number().int().min(0),
  literacyRate: z.number().min(0).max(100),
  incomeScore: z.number().min(0).max(100),
  incomeGroup: z.enum(INCOME_GROUPS),
});
export type AreaInput = z.input<typeof AreaInput>;
export const AreaUpdate = AreaInput.partial();
export type AreaUpdate = z.input<typeof AreaUpdate>;

/** GET /api/areas?near=lng,lat&q=&limit= */
export const AreaListQuery = z.object({
  near: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'Use near=lng,lat')
    .transform((s) => s.split(',').map(Number) as [number, number])
    .refine(([lng, lat]) => Math.abs(lng) <= 180 && Math.abs(lat) <= 90, 'Coordinates out of range')
    .optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const CategoryListQuery = z.object({
  parentId: z.union([ObjectIdString, z.literal('null')]).optional(),
});
