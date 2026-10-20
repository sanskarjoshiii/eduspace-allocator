import { describe, expect, it } from 'vitest';
import { DEFAULT_CENTER, isValidPoint, latLngToPoint, pointToLatLng, pointToTuple } from '@/components/forms/geo';
import { PointInput } from '@/schemas/common';

describe('LocationPicker geo conversion', () => {
  it('emits GeoJSON coordinates in [lng, lat] order', () => {
    const p = latLngToPoint({ lat: 18.5204, lng: 73.8567 });
    expect(p).toEqual({ type: 'Point', coordinates: [73.8567, 18.5204] });
    expect(PointInput.safeParse(p).success).toBe(true);
  });

  it('round-trips to Leaflet { lat, lng } and [lat, lng]', () => {
    const p = latLngToPoint({ lat: 18.5308, lng: 73.8359 });
    expect(pointToLatLng(p)).toEqual({ lat: 18.5308, lng: 73.8359 });
    expect(pointToTuple(p)).toEqual([18.5308, 73.8359]);
  });

  it('rounds to 6 decimals and wraps world copies back into range', () => {
    expect(latLngToPoint({ lat: 18.52040123456, lng: 73.85670987654 }).coordinates).toEqual([73.85671, 18.520401]);
    expect(latLngToPoint({ lat: 18.5, lng: 73.8 + 360 }).coordinates[0]).toBeCloseTo(73.8, 6);
  });

  it('defaults to Pune and validates points', () => {
    expect(DEFAULT_CENTER).toEqual({ lat: 18.5204, lng: 73.8567 });
    expect(isValidPoint({ type: 'Point', coordinates: [73.8, 18.5] })).toBe(true);
    expect(isValidPoint({ type: 'Point', coordinates: [18.5, 200] })).toBe(false);
    expect(isValidPoint(null)).toBe(false);
  });
});
