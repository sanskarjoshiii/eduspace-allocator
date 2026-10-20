import { describe, expect, it } from 'vitest';
import { findWindowProblems, sortWindows, timeOptions } from '@/components/forms/window-utils';
import { defaultFilters, demandRadius, filterMapData, mapCategories } from '@/components/map/map-utils';
import type { MapData } from '@/components/map/map-types';
import { formatDelta } from '@/components/ui/delta';
import { statusLabel } from '@/components/ui/badge';
import { initials } from '@/components/ui/feedback';
import { splitCommaList } from '@/components/forms/form-fields';
import { cn } from '@/components/ui/cn';

describe('findWindowProblems', () => {
  it('accepts non-overlapping windows', () => {
    expect(findWindowProblems([{ dayOfWeek: 6, startTime: '10:00', endTime: '13:00' }, { dayOfWeek: 6, startTime: '13:00', endTime: '15:00' }])).toEqual({});
  });
  it('flags overlaps on the same day only', () => {
    const p = findWindowProblems([
      { dayOfWeek: 6, startTime: '10:00', endTime: '13:00' },
      { dayOfWeek: 6, startTime: '12:00', endTime: '14:00' },
      { dayOfWeek: 0, startTime: '12:00', endTime: '14:00' },
    ]);
    expect(p[0]).toBe('Overlaps with Sat 12:00–14:00.');
    expect(p[1]).toBe('Overlaps with Sat 10:00–13:00.');
    expect(p[2]).toBeUndefined();
  });
  it('flags end before start and bad times', () => {
    expect(findWindowProblems([{ dayOfWeek: 1, startTime: '14:00', endTime: '10:00' }])[0]).toBe('End time must be after start time.');
    expect(findWindowProblems([{ dayOfWeek: 1, startTime: '9:00', endTime: '10:00' }])[0]).toBe('Use 24-hour HH:mm times.');
  });
  it('builds 24-hour options and sorts windows', () => {
    const t = timeOptions(30);
    expect(t[0]).toBe('00:00');
    expect(t).toContain('13:30');
    expect(t[t.length - 1]).toBe('23:59');
    expect(sortWindows([{ dayOfWeek: 2, startTime: '09:00', endTime: '10:00' }, { dayOfWeek: 1, startTime: '11:00', endTime: '12:00' }])[0]!.dayOfWeek).toBe(1);
  });
});

describe('map filters', () => {
  const pt = (lng: number, lat: number) => ({ type: 'Point' as const, coordinates: [lng, lat] as [number, number] });
  const data: MapData = {
    spaces: [
      { id: 'a', name: 'A', status: 'available', location: pt(73.8, 18.5), seats: 10, categories: ['Music'] },
      { id: 'b', name: 'B', status: 'booked', location: pt(73.9, 18.6), seats: 20, categories: ['Study'] },
    ],
    demand: [
      { areaId: '1', areaName: 'X', centre: pt(73.8, 18.5), openRequests: 40, level: 'High', category: 'Music' },
      { areaId: '2', areaName: 'Y', centre: pt(73.9, 18.6), openRequests: 5, level: 'Emerging', category: 'Study' },
    ],
  };
  it('applies available only, category, level and layer toggles', () => {
    const f = defaultFilters();
    expect(filterMapData(data, { ...f, availableOnly: true }).spaces.map((s) => s.id)).toEqual(['a']);
    expect(filterMapData(data, { ...f, category: 'Study' }).spaces.map((s) => s.id)).toEqual(['b']);
    expect(filterMapData(data, { ...f, demandLevel: 'High' }).demand.map((d) => d.areaId)).toEqual(['1']);
    expect(filterMapData(data, { ...f, layers: { ...f.layers, spaces: false } }).spaces).toEqual([]);
    expect(mapCategories(data)).toEqual(['Music', 'Study']);
  });
  it('sizes demand circles within 8–28 px', () => {
    expect(demandRadius(0, 40)).toBe(8);
    expect(demandRadius(40, 40)).toBe(28);
    expect(demandRadius(10, 40)).toBe(18);
  });
});

describe('display helpers', () => {
  it('formats deltas with sign', () => {
    expect(formatDelta(12.4)).toBe('+12.4%');
    expect(formatDelta(-3)).toBe('−3.0%');
    expect(formatDelta(0, 0, '')).toBe('0');
  });
  it('labels statuses in words', () => {
    expect(statusLabel('ApprovedBySpace')).toBe('Approved');
    expect(statusLabel('NeedsReallocation')).toBe('Needs reallocation');
    expect(statusLabel('PendingApproval')).toBe('Pending approval');
    expect(statusLabel('Offered')).toBe('Offered');
  });
  it('makes initials, splits comma lists and merges token classes', () => {
    expect(initials('Asha Kulkarni')).toBe('AK');
    expect(initials('ravi.patil@example.in')).toBe('RP');
    expect(splitCommaList(' ramp, , lift ')).toEqual(['ramp', 'lift']);
    expect(cn('text-control text-ink')).toBe('text-control text-ink');
  });
});
