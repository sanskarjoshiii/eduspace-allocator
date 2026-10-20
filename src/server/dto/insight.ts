import type { DemandLevel } from '@/lib/domain';

/** One aggregated demand row per area and course category. Never carries individual learners. */
export interface DemandInsightDto {
  areaId: string;
  areaName: string;
  /** Area centre, [lng, lat]. */
  areaCenter: [number, number];
  categoryId: string;
  categoryName: string;
  level: DemandLevel;
  demand: number;
  seatsOffered: number;
  gap: number;
  computedAt: string;
  /** True for the signed-in learner's own area. */
  isOwnArea: boolean;
}

export interface DemandInsightList {
  items: DemandInsightDto[];
  /** The learner's own area (profile or latest request); null for other roles or when unknown. */
  ownAreaId: string | null;
  computedAt: string | null;
}

/** Per-area totals for heatmaps. */
export interface AreaDemandDto {
  areaId: string;
  areaName: string;
  areaCenter: [number, number];
  demandLevel: DemandLevel | null;
  demandIndex: number | null;
  demand: number;
  seatsOffered: number;
  gap: number;
  openRequests: number;
  categories: number;
}
