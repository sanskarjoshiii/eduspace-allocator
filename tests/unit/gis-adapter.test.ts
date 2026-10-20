import { describe, expect, it } from 'vitest';
import { adaptMapPayload, mapQueryParams, payloadLayers, pickLayers } from '@/components/gis/map-adapter';
import type { MapPayload } from '@/server/dto/map';

const SPACE: [number, number] = [73.8077, 18.5074];
const AREA_A: [number, number] = [73.8143, 18.5089];
const AREA_B: [number, number] = [73.9197, 18.5590];
const LEARNER_EXACT: [number, number] = [73.812345, 18.506789];

function payload(): MapPayload {
  return {
    layers: {
      spaces: [
        {
          id: 's1', name: 'Kothrud Hall', coordinates: SPACE, status: 'available', seatCapacity: 30,
          areaId: 'a1', areaName: 'Kothrud', owned: true, openHours: 20, bookedHours: 6,
        },
      ],
      allocations: [
        {
          allocationId: 'al1', offeringTitle: 'Spoken English', categoryId: 'c1', status: 'Scheduled',
          spaceId: 's1', spaceName: 'Kothrud Hall', from: SPACE,
          to: [
            { areaId: 'a1', areaName: 'Kothrud', center: AREA_A, learners: 12 },
            { areaId: 'a2', areaName: 'Viman Nagar', center: AREA_B, learners: 3 },
          ],
        },
      ],
      demand: [
        { areaId: 'a1', areaName: 'Kothrud', center: AREA_A, demandLevel: 'High', openRequests: 40, demand: 40, seatsOffered: 30, gap: 10 },
        { areaId: 'a2', areaName: 'Viman Nagar', center: AREA_B, demandLevel: null, openRequests: 2, demand: 2, seatsOffered: 0, gap: 2 },
      ],
      offers: [
        {
          allocationId: 'al1', offeringId: 'o1', title: 'Spoken English', categoryId: 'c1', categoryName: 'Languages',
          spaceName: 'Kothrud Hall', coordinates: SPACE, session: 'Sat 10:00–12:00', seatsLeft: 4, distanceKm: 1.24,
          requestId: 'r1', feePerMonth: null,
        },
      ],
      unused: [
        { spaceId: 's1', spaceName: 'Kothrud Hall', coordinates: SPACE, openHours: 20, bookedHours: 6, freeHours: 14, freeSlots: ['Sun 09:00–12:00'] },
      ],
    },
    center: AREA_A,
    home: { areaId: 'a1', areaName: 'Kothrud', center: AREA_A },
  };
}

describe('GIS adapter (GET /api/map -> MapView)', () => {
  it('keeps GeoJSON [lng, lat] order on every layer', () => {
    const d = adaptMapPayload(payload(), { categoryNames: { c1: 'Languages' } });
    expect(d.spaces?.[0]?.location).toEqual({ type: 'Point', coordinates: SPACE });
    expect(d.allocations?.[0]?.from.coordinates).toEqual(SPACE);
    expect(d.allocations?.[0]?.to.coordinates).toEqual(AREA_A);
    expect(d.demand?.[0]?.centre.coordinates).toEqual(AREA_A);
    expect(d.offers?.[0]?.location.coordinates).toEqual(SPACE);
    expect(d.unusedHours?.[0]?.location.coordinates).toEqual(SPACE);
    // longitude first: Pune is ~73.8 E, ~18.5 N
    expect(d.spaces?.[0]?.location.coordinates[0]).toBeGreaterThan(70);
  });

  it('maps field names and splits allocation lines per learner area centre', () => {
    const d = adaptMapPayload(payload(), { categoryNames: { c1: 'Languages' } });
    expect(d.spaces?.[0]).toMatchObject({ id: 's1', seats: 30, status: 'available', areaName: 'Kothrud', href: '/spaces/s1' });
    expect(d.allocations).toHaveLength(2);
    expect(d.allocations?.[1]).toMatchObject({ areaName: 'Viman Nagar', learners: 3, category: 'Languages', href: '/allocations/al1' });
    expect(d.offers?.[0]).toMatchObject({ schedule: 'Sat 10:00–12:00', distanceKm: 1.24, category: 'Languages', href: '/offerings/o1' });
    expect(d.unusedHours?.[0]).toMatchObject({ spaceId: 's1', name: 'Kothrud Hall', hours: 14 });
  });

  it('leaves areas without a demand level off the heatmap', () => {
    const d = adaptMapPayload(payload());
    expect(d.demand?.map((x) => x.areaId)).toEqual(['a1']);
  });

  it('never carries exact learner points, even if the payload grew an extra field', () => {
    const p = payload() as unknown as { layers: Record<string, Record<string, unknown>[]> };
    p.layers.offers![0]!.learnerLocation = LEARNER_EXACT;
    p.layers.allocations![0]!.learners = [{ location: LEARNER_EXACT }];
    (p.layers.allocations![0]!.to as Record<string, unknown>[])[0]!.location = LEARNER_EXACT;
    p.layers.demand![0]!.requests = [{ location: LEARNER_EXACT }];
    const d = adaptMapPayload(p as unknown as MapPayload);
    const json = JSON.stringify(d);
    expect(json).not.toContain(String(LEARNER_EXACT[0]));
    expect(json).not.toContain(String(LEARNER_EXACT[1]));
    expect(json).not.toMatch(/learnerLocation|"location":\{"type":"Point","coordinates":\[73\.812345/);

    // Every coordinate in the output is a space point or an area centre from the payload.
    const allowed = new Set([SPACE, AREA_A, AREA_B].map((c) => c.join(',')));
    const coords: string[] = [];
    JSON.parse(json, (k, v) => {
      if (k === 'coordinates') coords.push((v as number[]).join(','));
      return v;
    });
    expect(coords.length).toBeGreaterThan(0);
    for (const c of coords) expect(allowed.has(c)).toBe(true);
  });

  it('handles empty payloads and picks layers', () => {
    expect(adaptMapPayload(undefined)).toEqual({});
    expect(payloadLayers(payload())).toEqual(['spaces', 'allocations', 'demand', 'offers', 'unusedHours']);
    const picked = pickLayers(adaptMapPayload(payload()), { spaces: true, demand: false });
    expect(picked.spaces).toHaveLength(1);
    expect(picked.demand).toBeUndefined();
    expect(picked.offers).toBeUndefined();
  });

  it('builds the query without layers and only with set filters', () => {
    expect(mapQueryParams({ availableOnly: false, categoryId: '', level: '' })).toEqual({ availableOnly: undefined, categoryId: undefined, level: undefined });
    expect(mapQueryParams({ availableOnly: true, categoryId: 'c1', level: 'High' })).toEqual({ availableOnly: '1', categoryId: 'c1', level: 'High' });
  });
});
