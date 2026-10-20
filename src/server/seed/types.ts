import type { AgeBand, ApprovalMode, Audience, PartnerType, Role } from '@/lib/domain';
import type { LeafCategory } from './data/categories';
import type { FacilityName } from './data/facilities';
import type { LngLat } from './geo';

/**
 * A seed plan is plain data: no ids, no database. Lookups are referenced by name and
 * resolved to ObjectIds when the plan is applied. Same config + same `now` = identical plan.
 */

export interface PlanWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface PlanSlot extends PlanWindow {
  isBlocked: boolean;
}

export interface PlanAccount {
  email: string;
  name: string;
  role: Exclude<Role, 'Administrator'>;
  /** Named accounts (learner@, spaces@, provider@ and the e2e logins) use the demo password. */
  named: boolean;
}

export interface PlanSpace {
  name: string;
  description: string;
  address: string;
  areaName: string;
  location: LngLat;
  seatCapacity: number;
  facilities: { facility: FacilityName; quantity: number; workingQuantity: number }[];
  slots: PlanSlot[];
  policy: {
    /** Empty = every category. */
    categories: LeafCategory[];
    /** Empty = every audience. */
    audiences: Audience[];
    rentPerHour: number;
    approvalMode: ApprovalMode;
    rules: string;
  };
}

export interface PlanSpaceGiver {
  account: PlanAccount;
  partner: { type: Extract<PartnerType, 'SpaceGiverOrg'>; name: string; contactPhone: string; about: string };
  spaces: PlanSpace[];
}

export interface PlanOffering {
  audience: Audience;
  batchSize: number;
  sessionMinutes: number;
  durationWeeks: number;
  startDate: Date;
  targetAreaName: string | null;
  windows: PlanWindow[];
  maxRentPerHour: number | null;
  feePerMonth: number | null;
  /** The space the generator built this offering around (index into the flat space list). Not stored. */
  anchorSpaceIndex: number;
}

export interface PlanCourse {
  title: string;
  description: string;
  category: LeafCategory;
  requirements: { facility: FacilityName; minQuantity: number }[];
  offerings: PlanOffering[];
}

export interface PlanProvider {
  account: PlanAccount;
  partner: { type: Extract<PartnerType, 'ProviderOrg' | 'IndividualTutor'>; name: string; contactPhone: string; about: string };
  courses: PlanCourse[];
}

export const INFEASIBLE_REASONS = ['far', 'category', 'budget', 'facility', 'time'] as const;
export type InfeasibleReason = (typeof INFEASIBLE_REASONS)[number];
export type RequestIntent = 'feasible' | InfeasibleReason;

export interface PlanRequest {
  category: LeafCategory;
  areaName: string;
  location: LngLat;
  audience: Audience;
  maxDistanceKm: number;
  startMonth: string;
  durationMonths: number;
  windows: PlanWindow[];
  requiredFacilities: FacilityName[];
  budgetPerMonth: number | null;
  notes: string;
  /** What the generator intended. Not stored in the database. */
  intent: RequestIntent;
}

export interface PlanLearner {
  account: PlanAccount;
  ageBand: AgeBand;
  contactPhone: string;
  areaName: string;
  accessibilityNeeds: string[];
  requests: PlanRequest[];
}

export interface SeedPlan {
  spaceGivers: PlanSpaceGiver[];
  providers: PlanProvider[];
  /** A learner may have no requests (e.g. the e2e "fresh" learner who submits one in the browser). */
  learners: PlanLearner[];
}

export interface GeneratorConfig {
  seed: number;
  spaceGivers: number;
  /** Average; the total is round(spaceGivers * spacesPerGiver), spread evenly. */
  spacesPerGiver: number;
  providers: number;
  coursesPerProvider: number;
  offeringsPerCourse: number;
  learners: number;
  requestsPerLearner: number;
  /** Share of requests built to be feasible, 0..1. The rest are infeasible for a known reason. */
  feasibleRatio: number;
  /** Include learner@ / spaces@ / provider@ as the first generated accounts. */
  namedAccounts: boolean;
}
