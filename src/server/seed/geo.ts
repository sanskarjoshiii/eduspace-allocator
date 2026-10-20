import type { Rng } from './prng';

/** [lng, lat], GeoJSON order. */
export type LngLat = [number, number];

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Moves a point by `distanceKm` towards `bearingDeg` (0 = north, 90 = east). Good enough at city scale. */
export function offsetKm(origin: LngLat, distanceKm: number, bearingDeg: number): LngLat {
  const b = toRad(bearingDeg);
  const dLat = (distanceKm * Math.cos(b)) / 111.32;
  const dLng = (distanceKm * Math.sin(b)) / (111.32 * Math.cos(toRad(origin[1])));
  return [round6(origin[0] + dLng), round6(origin[1] + dLat)];
}

/** A uniformly distributed point within `radiusKm` of `origin`. */
export function jitter(rng: Rng, origin: LngLat, radiusKm: number): LngLat {
  const distance = radiusKm * Math.sqrt(rng.float());
  return offsetKm(origin, distance, rng.range(0, 360));
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
