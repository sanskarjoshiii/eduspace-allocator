import { Types } from 'mongoose';
import { Area } from '@/server/models';
import { HttpError } from '@/server/http';
import type { AreaRecord } from '@/server/dto/lookup';

/** A point farther than this from every area centre is outside the service area. */
export const SERVICE_AREA_KM = 25;

/** 422 with the same body shape as a Zod validation error, pinned to one field. */
export function unprocessable(message: string, field?: string): HttpError {
  return new HttpError(422, 'validation_failed', message, {
    formErrors: field ? [] : [message],
    fieldErrors: field ? { [field]: [message] } : {},
  });
}

let geoIndexReady: Promise<unknown> | null = null;
/** $geoNear needs the 2dsphere index; build it once per process (idempotent). */
function ensureGeoIndex(): Promise<unknown> {
  geoIndexReady ??= Area.createIndexes().catch((err: unknown) => {
    geoIndexReady = null;
    throw err;
  });
  return geoIndexReady;
}

/** Areas ordered by distance from `coords` ([lng, lat]), each with `distanceKm`. */
export async function nearestAreas(coords: [number, number], limit = 1, match: Record<string, unknown> = {}): Promise<AreaRecord[]> {
  await ensureGeoIndex();
  const rows = await Area.aggregate<AreaRecord & { distanceM: number }>([
    { $geoNear: { near: { type: 'Point', coordinates: coords }, distanceField: 'distanceM', spherical: true, query: match } },
    { $limit: limit },
  ]);
  return rows.map(({ distanceM, ...a }) => ({ ...a, distanceKm: distanceM / 1000 }));
}

/**
 * The area a point belongs to: the nearest area centre within SERVICE_AREA_KM.
 * Throws 422 "This location is outside the service area" otherwise.
 */
export async function snapToArea(coords: [number, number], field = 'location'): Promise<AreaRecord> {
  const [nearest] = await nearestAreas(coords, 1);
  if (!nearest || (nearest.distanceKm ?? Infinity) > SERVICE_AREA_KM) {
    throw unprocessable('This location is outside the service area', field);
  }
  return nearest;
}

/** Loads an area by id or throws 422 on the given field. */
export async function requireArea(id: string, field = 'areaId'): Promise<AreaRecord> {
  const area = Types.ObjectId.isValid(id) ? await Area.findById(id).lean<AreaRecord>() : null;
  if (!area) throw unprocessable('Choose a valid area', field);
  return area;
}
