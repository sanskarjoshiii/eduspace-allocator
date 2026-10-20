// Pure layer filtering and styling helpers for MapView (no Leaflet), unit-tested.
import type { DemandLevel } from '@/lib/domain';
import type { ThemeColors } from '@/hooks/use-css-colors';
import { MAP_LAYERS, type MapData, type MapFilters, type MapLayer, type MapSpaceStatus } from './map-types';

export function defaultFilters(enabled: readonly MapLayer[] = MAP_LAYERS, initial?: Partial<Record<MapLayer, boolean>>): MapFilters {
  const layers = Object.fromEntries(MAP_LAYERS.map((l) => [l, enabled.includes(l) && (initial?.[l] ?? true)])) as Record<MapLayer, boolean>;
  return { layers, availableOnly: false, category: '', demandLevel: '' };
}

/** Distinct sorted categories across layers (or the explicit list). */
export function mapCategories(data: MapData | undefined): string[] {
  if (!data) return [];
  if (data.categories?.length) return [...data.categories];
  const set = new Set<string>();
  data.spaces?.forEach((s) => s.categories?.forEach((c) => set.add(c)));
  data.allocations?.forEach((a) => a.category && set.add(a.category));
  data.demand?.forEach((d) => d.category && set.add(d.category));
  data.offers?.forEach((o) => o.category && set.add(o.category));
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Applies layer toggles, "available only", category and demand level. Hidden layers come back empty. */
export function filterMapData(data: MapData | undefined, f: MapFilters): Required<Omit<MapData, 'categories'>> {
  const cat = f.category;
  const byCat = <T>(list: T[] | undefined, get: (x: T) => string | string[] | undefined): T[] =>
    (list ?? []).filter((x) => {
      if (!cat) return true;
      const v = get(x);
      return Array.isArray(v) ? v.includes(cat) : v === cat;
    });
  return {
    spaces: f.layers.spaces
      ? byCat(data?.spaces, (s) => s.categories).filter((s) => !f.availableOnly || s.status === 'available')
      : [],
    allocations: f.layers.allocations ? byCat(data?.allocations, (a) => a.category) : [],
    demand: f.layers.demand ? byCat(data?.demand, (d) => d.category).filter((d) => !f.demandLevel || d.level === f.demandLevel) : [],
    offers: f.layers.offers ? byCat(data?.offers, (o) => o.category) : [],
    unusedHours: f.layers.unusedHours ? (data?.unusedHours ?? []) : [],
  };
}

export const SPACE_STATUS_LABEL: Record<MapSpaceStatus, string> = { available: 'Available', booked: 'Booked', inactive: 'Inactive' };

export function spaceColor(status: MapSpaceStatus, c: ThemeColors): string {
  return status === 'available' ? c.success : status === 'booked' ? c.accent : c['border-strong'];
}

export function demandColor(level: DemandLevel, c: ThemeColors): string {
  return level === 'High' ? c.accent : level === 'Medium' ? c.info : c.success;
}

/** Circle radius in px for a demand area: grows with the square root of open requests, 8–28 px. */
export function demandRadius(openRequests: number, maxRequests: number): number {
  if (maxRequests <= 0 || openRequests <= 0) return 8;
  return Math.round(8 + 20 * Math.sqrt(Math.min(1, openRequests / maxRequests)));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
