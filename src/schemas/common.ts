import { z } from 'zod';

export const ObjectIdString = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const HHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm');

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** A weekly window; end must be after start. */
export const WindowInput = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: HHmm,
    endTime: HHmm,
  })
  .refine((w) => toMin(w.endTime) > toMin(w.startTime), { message: 'End time must be after start time', path: ['endTime'] });
export type WindowInput = z.infer<typeof WindowInput>;

/** Windows on the same day must not overlap. */
export function noOverlap<T extends { dayOfWeek: number; startTime: string; endTime: string }>(windows: T[]): boolean {
  const sorted = [...windows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMin(a.startTime) - toMin(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.dayOfWeek === cur.dayOfWeek && toMin(cur.startTime) < toMin(prev.endTime)) return false;
  }
  return true;
}

/** GeoJSON point input as [lng, lat]. */
export const PointInput = z.object({
  type: z.literal('Point').default('Point'),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
});
export type PointInput = z.infer<typeof PointInput>;

export const Money = z.number().min(0).max(10_000_000);
