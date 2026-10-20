// Smart Allocation engine contract. Pure data in, pure data out: no I/O, no Date.now()
// inside decisions (time comes from `snapshot.now`), deterministic for a given seed.
// README section 13 is the specification.

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Audience = 'Children' | 'Teens' | 'Adults' | 'Seniors';
export type IncomeGroup = 'Low' | 'Medium' | 'High';
export type DemandLevel = 'High' | 'Medium' | 'Emerging';
export type Strategy = 'balanced' | 'accessibility' | 'reach' | 'cost';

/** Weekly time window, minutes from midnight, end > start. */
export interface TimeWindow {
  dayOfWeek: DayOfWeek;
  start: number;
  end: number;
}

export interface GeoPoint {
  lng: number;
  lat: number;
}

export interface EngineArea {
  id: string;
  name: string;
  center: GeoPoint;
  population: number;
  studentCount: number;
  literacyRate: number; // 0..100
  incomeScore: number; // 0..100
  incomeGroup: IncomeGroup;
}

export interface EngineCategory {
  id: string;
  name: string;
  parentId: string | null;
}

export interface EngineFacilityType {
  id: string;
  name: string;
}

export interface EngineSpace {
  id: string;
  name: string;
  ownerUserId: string;
  areaId: string;
  location: GeoPoint;
  isActive: boolean;
  seatCapacity: number;
  facilities: { facilityTypeId: string; quantity: number; workingQuantity: number }[];
  slots: (TimeWindow & { slotId: string; isBlocked: boolean })[];
  policy: {
    /** Empty = all categories allowed. */
    allowedCategoryIds: string[];
    /** Empty = all audiences allowed. */
    allowedAudiences: Audience[];
    rentPerHour: number;
    approvalMode: 'auto' | 'manual';
  };
  /** Sessions already booked on this space by allocations the run must not move. */
  bookings: TimeWindow[];
}

export interface EngineOffering {
  id: string;
  courseId: string;
  providerUserId: string;
  title: string;
  categoryId: string;
  audience: Audience;
  batchSize: number;
  /** Length of the one weekly session, minutes. */
  sessionMinutes: number;
  durationWeeks: number;
  targetAreaId: string | null;
  /** Provider's preferred weekly windows. Empty = any time a space is free. */
  windows: TimeWindow[];
  /** Max rent per hour the provider will pay. Null = no limit. */
  maxRentPerHour: number | null;
  /** Learner fee per month. Null = free. */
  feePerMonth: number | null;
  requirements: { facilityTypeId: string; minQuantity: number }[];
  /**
   * Present when the offering already has an allocation the run must keep (approved,
   * confirmed, scheduled or active). The engine skips space matching for it and only
   * assigns learners to its remaining seats.
   */
  fixed?: { allocationId: string; spaceId: string; session: TimeWindow; seatsTaken: number };
}

export interface EngineRequest {
  id: string;
  learnerUserId: string;
  categoryId: string;
  areaId: string;
  /** Exact point; never leaves the server. */
  location: GeoPoint;
  audience: Audience;
  maxDistanceKm: number;
  /** Empty = flexible to the tutor's timing. */
  windows: TimeWindow[];
  requiredFacilityTypeIds: string[];
  /** Null = no budget limit. */
  budgetPerMonth: number | null;
  /** ISO string; older requests win ties (fairness). */
  createdAt: string;
}

export interface EngineDemandBaseline {
  areaId: string;
  categoryId: string;
  baseline: number;
}

export interface EngineSnapshot {
  /** ISO timestamp of the snapshot; the only clock the engine may read. */
  now: string;
  areas: EngineArea[];
  categories: EngineCategory[];
  facilityTypes: EngineFacilityType[];
  spaces: EngineSpace[];
  offerings: EngineOffering[];
  requests: EngineRequest[];
  demandBaseline: EngineDemandBaseline[];
}

export interface Weights {
  distance: number;
  time: number;
  facility: number;
  capacity: number;
  cost: number;
  demand: number;
  utilisation: number;
}

export interface EngineSettings {
  strategy: Strategy;
  /** Already normalised to sum to 1. */
  weights: Weights;
  maxRadiusKm: number;
  /** Space–offering edges below this score are dropped before matching. */
  minEdgeScore: number;
  seed: number;
  kMin: number;
  kMax: number;
  kInits: number;
  /** How many rejected alternatives to keep per allocation (default 3). */
  alternativesToKeep: number;
  /** How many suggestions to keep per unmatched request (default 3). */
  suggestionCount: number;
}

/** The seven hard constraints, in check order (README 13.4). */
export type ConstraintName = 'active' | 'time' | 'capacity' | 'facilities' | 'policy' | 'distance' | 'budget';
export const CONSTRAINT_ORDER: readonly ConstraintName[] = ['active', 'time', 'capacity', 'facilities', 'policy', 'distance', 'budget'];
export const CONSTRAINT_LABEL: Record<ConstraintName, string> = {
  active: 'Space active and slot open',
  time: 'Time window',
  capacity: 'Seats',
  facilities: 'Facilities',
  policy: 'Space policy',
  distance: 'Distance',
  budget: 'Rent and budget',
};

/** The seven sub-scores (README 13.5). */
export type SubScoreName = keyof Weights;
export const SUBSCORE_LABEL: Record<SubScoreName, string> = {
  distance: 'Distance',
  time: 'Time fit',
  facility: 'Facility fit',
  capacity: 'Capacity fit',
  cost: 'Cost fit',
  demand: 'Demand priority',
  utilisation: 'Space utilisation',
};

export interface ConstraintResult {
  constraint: ConstraintName;
  passed: boolean;
  /** Plain-language facts with units, e.g. "20 working computers, the course needs 18". */
  detail: string;
}

export interface ScoreBreakdown {
  criterion: SubScoreName;
  score: number; // 0..1
  weight: number;
  weighted: number; // score * weight
  detail: string;
}

export interface RejectedAlternative {
  spaceId: string;
  spaceName: string;
  session: TimeWindow | null;
  /** First failed hard constraint, or null when it was feasible but scored lower. */
  failedConstraint: ConstraintName | null;
  reason: string;
  score: number | null;
  distanceKm: number | null;
}

export interface ProposedAllocation {
  offeringId: string;
  spaceId: string;
  session: TimeWindow;
  /** Compatibility score in [0, 1]. Never a probability. */
  score: number;
  /** Distance from the space to the offering's demand centre (cohort centroid or target area). */
  distanceKm: number;
  breakdown: ScoreBreakdown[];
  constraints: ConstraintResult[];
  rejectedAlternatives: RejectedAlternative[];
}

export interface LearnerAssignment {
  requestId: string;
  offeringId: string;
  /** Space the learner would attend (fixed or newly proposed allocation). */
  spaceId: string;
  /** 'seat' = within seat limits; 'waitlist' = feasible but seats are full. */
  kind: 'seat' | 'waitlist';
  score: number;
  distanceKm: number;
  /** 1-based rank on the offering's waitlist; null for seats. */
  waitlistRank: number | null;
  secondBest: { offeringId: string; score: number } | null;
}

export interface Suggestion {
  /** Null when the suggestion is a category/area rather than a concrete offering. */
  offeringId: string | null;
  categoryId: string;
  areaId: string | null;
  score: number;
  reasons: string[];
}

export interface UnmatchedRequest {
  requestId: string;
  /** Why no offering fits, e.g. "No open Coding offering within 5 km". */
  reason: string;
  suggestions: Suggestion[];
}

export interface AreaDemand {
  areaId: string;
  clusterId: number;
  level: DemandLevel;
  demandIndex: number;
}

export interface DemandInsightRow {
  areaId: string;
  categoryId: string;
  /** Open requests plus baseline demand for the area and category. */
  demand: number;
  seatsOffered: number;
  /** demand - seatsOffered (can be negative). */
  gap: number;
  level: DemandLevel;
}

export interface Cohort {
  categoryId: string;
  centroid: GeoPoint;
  requestIds: string[];
}

export interface RunMetrics {
  requests: number;
  assigned: number;
  waitlisted: number;
  unmatched: number;
  allocations: number;
  /** assigned / requests */
  coverageRate: number;
  avgDistanceKm: number;
  /** seats filled / seats offered across allocated offerings */
  seatUtilisation: number;
  /** weekly booked hours across all spaces, including fixed bookings */
  spaceUtilisationHours: number;
  avgScore: number;
  /** waitlisted / requests */
  waitlistRate: number;
  /** Weighted blend of match score, capacity utilisation, cost efficiency and reach, 0..1. */
  optimisationScore: number;
  runTimeMs: number;
}

export interface PipelineResult {
  allocations: ProposedAllocation[];
  assignments: LearnerAssignment[];
  unmatched: UnmatchedRequest[];
  areaDemand: AreaDemand[];
  insights: DemandInsightRow[];
  cohorts: Cohort[];
  metrics: RunMetrics;
  /** Greedy nearest-space baseline computed on the same snapshot. */
  baselineMetrics: RunMetrics;
  k: number;
  silhouette: number;
}

/** Result of re-checking one booked allocation after a facility change. */
export interface RecheckResult {
  allocationId: string;
  stillFeasible: boolean;
  failedConstraint: ConstraintName | null;
  reason: string;
  /** Best alternatives (feasible, highest score first) when it no longer fits. */
  alternatives: ProposedAllocation[];
}

/** Public engine surface, implemented in src/engine/index.ts. */
export interface EngineClient {
  runPipeline(snapshot: EngineSnapshot, settings: EngineSettings): PipelineResult;
  recheckAllocations(
    snapshot: EngineSnapshot,
    settings: EngineSettings,
    allocations: { allocationId: string; offeringId: string; spaceId: string; session: TimeWindow }[],
  ): RecheckResult[];
  suggestFor(snapshot: EngineSnapshot, settings: EngineSettings, requestId: string): Suggestion[];
}
