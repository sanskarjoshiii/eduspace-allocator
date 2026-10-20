import type { DemandLevel } from '@/lib/domain';

/** [lng, lat]. Learner positions only ever appear as AREA CENTRES. */
export type LngLat = [number, number];

export type SpaceMapStatus = 'available' | 'booked' | 'inactive';

export interface MapSpace {
  id: string;
  name: string;
  coordinates: LngLat;
  status: SpaceMapStatus;
  seatCapacity: number;
  areaId: string;
  areaName: string;
  /** True for the viewer's own spaces (Space Giver) and for every space for administrators. */
  owned: boolean;
  /** Weekly hours; only on owned spaces. */
  openHours: number | null;
  bookedHours: number | null;
}

export interface MapAllocationLine {
  allocationId: string;
  offeringTitle: string;
  categoryId: string;
  status: string;
  spaceId: string;
  spaceName: string;
  /** Space point. */
  from: LngLat;
  /** Learner AREA CENTRES with the count of enrolled learners from each. */
  to: { areaId: string; areaName: string; center: LngLat; learners: number }[];
}

export interface MapDemandArea {
  areaId: string;
  areaName: string;
  center: LngLat;
  demandLevel: DemandLevel | null;
  openRequests: number;
  demand: number;
  seatsOffered: number;
  gap: number;
}

export interface MapOffer {
  allocationId: string;
  offeringId: string;
  title: string;
  categoryId: string;
  categoryName: string;
  spaceName: string;
  coordinates: LngLat;
  session: string;
  seatsLeft: number;
  /** From the learner's request AREA CENTRE. */
  distanceKm: number;
  requestId: string;
  feePerMonth: number | null;
}

export interface MapUnusedSpace {
  spaceId: string;
  spaceName: string;
  coordinates: LngLat;
  openHours: number;
  bookedHours: number;
  freeHours: number;
  freeSlots: string[];
}

export interface MapPayload {
  /** Layers the viewer may see among those requested; others are absent. */
  layers: {
    spaces?: MapSpace[];
    allocations?: MapAllocationLine[];
    demand?: MapDemandArea[];
    offers?: MapOffer[];
    unused?: MapUnusedSpace[];
  };
  /** Suggested map centre: the learner's home area centre, else the centre of the visible spaces. */
  center: LngLat | null;
  /** The learner's home area (area centre only), for the "you are here" marker. */
  home: { areaId: string; areaName: string; center: LngLat } | null;
}
