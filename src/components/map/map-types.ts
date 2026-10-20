// Typed props for MapView, matching what GET /api/map returns ({ data: MapData }).
// All points are GeoJSON [lng, lat]. Learner locations are area centres only (privacy).
import type { DemandLevel } from '@/lib/domain';
import type { GeoPoint } from '@/components/forms/geo';

export type { GeoPoint };

export type MapSpaceStatus = 'available' | 'booked' | 'inactive';

export interface MapSpace {
  id: string;
  name: string;
  status: MapSpaceStatus;
  location: GeoPoint;
  seats: number;
  areaName?: string;
  /** Course categories the space suits (for the category filter). */
  categories?: string[];
  href?: string;
}

export interface MapAllocationLine {
  id: string;
  /** Space point. */
  from: GeoPoint;
  /** Learner cohort area centre (never an exact learner point). */
  to: GeoPoint;
  spaceName?: string;
  areaName?: string;
  courseTitle?: string;
  category?: string;
  learners?: number;
  href?: string;
}

export interface MapDemandArea {
  areaId: string;
  areaName: string;
  /** Area centre. */
  centre: GeoPoint;
  openRequests: number;
  level: DemandLevel;
  category?: string;
}

export interface MapOffer {
  id: string;
  title: string;
  location: GeoPoint;
  spaceName?: string;
  category?: string;
  /** Pre-formatted, e.g. "Sat 10:00–13:00". */
  schedule?: string;
  distanceKm?: number;
  href?: string;
}

export interface MapUnusedHours {
  spaceId: string;
  name: string;
  location: GeoPoint;
  /** Idle hours per week. */
  hours: number;
}

export interface MapData {
  spaces?: MapSpace[];
  allocations?: MapAllocationLine[];
  demand?: MapDemandArea[];
  offers?: MapOffer[];
  unusedHours?: MapUnusedHours[];
  /** Category names for the filter; derived from the layers when omitted. */
  categories?: string[];
}

export const MAP_LAYERS = ['spaces', 'allocations', 'demand', 'offers', 'unusedHours'] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];
export const MAP_LAYER_LABEL: Record<MapLayer, string> = {
  spaces: 'Spaces',
  allocations: 'Allocations',
  demand: 'Demand',
  offers: 'Offers',
  unusedHours: 'Unused Hours',
};

export interface MapFilters {
  layers: Record<MapLayer, boolean>;
  availableOnly: boolean;
  /** '' = all categories. */
  category: string;
  /** '' = all levels. */
  demandLevel: DemandLevel | '';
}
