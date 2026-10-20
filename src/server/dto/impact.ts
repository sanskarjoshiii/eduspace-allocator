export interface ImpactMetrics {
  learnersServed: number;
  learningHours: number;
  providersWithVenue: number;
  sessionsScheduled: number;
  spacesUsed: number;
  idleHoursUsed: number;
  areasReached: number;
  highDemandAreasServed: number;
  avgDistanceKm: number;
  spaceUtilisation: number;
  activeSpaceGivers: number;
  activeProviders: number;
  ngoPartners: number;
}

export interface ImpactSnapshotDto {
  /** "YYYY-MM" */
  period: string;
  metrics: ImpactMetrics;
  computedAt: string;
  /** False when no snapshot is stored yet and the numbers were computed on request. */
  stored: boolean;
}

export interface ImpactResponse {
  latest: ImpactSnapshotDto;
  /** Oldest first, up to 12 months, for trend charts. */
  history: ImpactSnapshotDto[];
}

export interface SdgIndicator {
  key: string;
  label: string;
  value: number;
  unit: 'count' | 'hours' | 'km' | 'ratio';
  /** Where the value comes from: the monthly snapshot or a live count. */
  source: 'snapshot' | 'live';
}

export interface SdgGoal {
  goal: 4 | 8 | 9 | 10 | 11 | 17;
  title: string;
  indicators: SdgIndicator[];
}

export interface SdgResponse {
  period: string;
  computedAt: string;
  goals: SdgGoal[];
}

/** Public, unauthenticated headline numbers. Aggregates only, no personal data. */
export interface PublicImpactDto {
  period: string;
  learnersServed: number;
  learningHours: number;
  sessionsScheduled: number;
  spacesUsed: number;
  areasReached: number;
  activeSpaceGivers: number;
  activeProviders: number;
  ngoPartners: number;
  computedAt: string;
}
