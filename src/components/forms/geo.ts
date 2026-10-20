// GeoJSON <-> Leaflet conversion. GeoJSON is [lng, lat]; Leaflet is { lat, lng } / [lat, lng].

export interface GeoPoint {
  type: 'Point';
  /** [longitude, latitude] */
  coordinates: [number, number];
}

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

/** Default map centre: Pune. */
export const DEFAULT_CENTER: LatLngLiteral = { lat: 18.5204, lng: 73.8567 };
export const DEFAULT_ZOOM = 12;

const round = (n: number, digits = 6) => Number(n.toFixed(digits));

/** Leaflet { lat, lng } -> GeoJSON Point with [lng, lat] (rounded to 6 decimals, ~0.1 m). */
export function latLngToPoint(ll: LatLngLiteral): GeoPoint {
  const lng = ((((ll.lng + 180) % 360) + 360) % 360) - 180; // wrap world copies back into [-180, 180)
  return { type: 'Point', coordinates: [round(lng), round(Math.max(-90, Math.min(90, ll.lat)))] };
}

/** GeoJSON Point -> Leaflet { lat, lng }. */
export function pointToLatLng(p: { coordinates: readonly [number, number] | readonly number[] }): LatLngLiteral {
  const [lng = 0, lat = 0] = p.coordinates;
  return { lat, lng };
}

/** GeoJSON Point -> Leaflet tuple [lat, lng]. */
export function pointToTuple(p: { coordinates: readonly [number, number] | readonly number[] }): [number, number] {
  const { lat, lng } = pointToLatLng(p);
  return [lat, lng];
}

export function isValidPoint(p: unknown): p is GeoPoint {
  if (!p || typeof p !== 'object') return false;
  const c = (p as { coordinates?: unknown }).coordinates;
  return (
    Array.isArray(c) &&
    c.length === 2 &&
    typeof c[0] === 'number' &&
    typeof c[1] === 'number' &&
    Math.abs(c[0]) <= 180 &&
    Math.abs(c[1]) <= 90
  );
}
