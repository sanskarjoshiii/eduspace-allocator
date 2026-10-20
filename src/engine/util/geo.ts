import type { GeoPoint } from '../types';

const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Equirectangular projection to kilometres around `ref`. Accurate enough at city scale. */
export function projectKm(p: GeoPoint, ref: GeoPoint): [number, number] {
  const x = (p.lng - ref.lng) * RAD * EARTH_RADIUS_KM * Math.cos(ref.lat * RAD);
  const y = (p.lat - ref.lat) * RAD * EARTH_RADIUS_KM;
  return [x, y];
}

/** Arithmetic mean of points (fine for city-scale clusters). */
export function meanPoint(points: readonly GeoPoint[]): GeoPoint {
  if (points.length === 0) return { lng: 0, lat: 0 };
  let lng = 0;
  let lat = 0;
  for (const p of points) {
    lng += p.lng;
    lat += p.lat;
  }
  return { lng: lng / points.length, lat: lat / points.length };
}
