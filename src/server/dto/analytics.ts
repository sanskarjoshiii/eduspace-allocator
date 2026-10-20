import type { AreaDemandDto } from './insight';
import type { ImpactMetrics } from './impact';
import type { DiscoverOffering } from '@/server/services/recommendations';

export interface WeekPoint {
  /** Monday of the ISO week, "YYYY-MM-DD". */
  week: string;
  requests: number;
  seatsOffered: number;
  seatsFilled: number;
}

export interface AdminKpis {
  requestsTotal: number;
  requestsByStatus: Record<string, number>;
  /** Requests placed (matched or later) / requests not cancelled, 0..1. */
  coverageRate: number;
  /** Mean learner distance over seat-holding enrollments, km. */
  avgDistanceKm: number;
  /** Seats held / seats offered on offerings with a live allocation, 0..1. */
  seatUtilisation: number;
  /** Weekly booked hours across all spaces. */
  spaceUtilisationHours: number;
  /** Weekly open (unblocked) slot hours on active spaces. */
  spaceOpenHours: number;
  /** Requests with a waitlisted enrollment / requests not cancelled, 0..1. */
  waitlistRate: number;
  runsLast30Days: number;
  runsByStatusLast30Days: Record<string, number>;
  unmatchedCount: number;
  facilityAlertsOpen: number;
  allocationsByStatus: Record<string, number>;
  trend: WeekPoint[];
}

export interface SpaceUsageRow {
  spaceId: string;
  spaceName: string;
  isActive: boolean;
  seatCapacity: number;
  openHours: number;
  bookedHours: number;
  unusedHours: number;
  /** bookedHours / openHours, 0..1. */
  utilisation: number;
}

export interface WeekdayUsage {
  dayOfWeek: number;
  openHours: number;
  bookedHours: number;
}

export interface SpaceGiverAnalytics {
  scope: 'SpaceGiver';
  ownerId: string;
  spaces: SpaceUsageRow[];
  byWeekday: WeekdayUsage[];
  totals: { openHours: number; bookedHours: number; unusedHours: number; utilisation: number };
  upcomingSessions: number;
  pendingApprovals: number;
  sessionsHeld: number;
  issuesOpen: number;
}

export interface HighDemandArea {
  areaId: string;
  areaName: string;
  areaCenter: [number, number];
  categoryId: string;
  categoryName: string;
  level: string;
  demand: number;
  seatsOffered: number;
  gap: number;
}

export interface ProviderAnalytics {
  scope: 'CourseProvider';
  ownerId: string;
  offeringsByStatus: Record<string, number>;
  seatsOffered: number;
  seatsFilled: number;
  acceptedLearners: number;
  /** present / marked across own classes, 0..1; null before any marking. */
  attendanceRate: number | null;
  averageRating: number | null;
  ratingsCount: number;
  highDemandAreas: HighDemandArea[];
}

export interface AdminAnalytics {
  scope: 'Administrator';
  kpis: AdminKpis;
}

export type AnalyticsResponse = AdminAnalytics | SpaceGiverAnalytics | ProviderAnalytics;

// ---- Dashboards (README 17) ----

export interface LatestRunDto {
  id: string;
  status: string;
  trigger: string;
  strategy: string;
  startedAt: string | null;
  finishedAt: string | null;
  metrics: unknown;
  baselineMetrics: unknown;
  counts: unknown;
  error: string;
}

export interface UnmatchedRequestDto {
  id: string;
  learnerName: string;
  categoryName: string;
  areaName: string;
  status: string;
  createdAt: string;
  /** The top suggestion's first reason, when the last run stored one. */
  topSuggestion: string | null;
}

export interface FacilityAlertDto {
  id: string;
  spaceId: string;
  spaceName: string;
  facilityName: string;
  affectedQuantity: number;
  affectedAllocations: number;
  createdAt: string;
}

export interface AdminDashboard {
  role: 'Administrator';
  kpis: AdminKpis;
  latestRun: LatestRunDto | null;
  unmatchedRequests: UnmatchedRequestDto[];
  facilityAlerts: FacilityAlertDto[];
  demandByArea: AreaDemandDto[];
  utilisation: { bookedHours: number; openHours: number; ratio: number; seatUtilisation: number };
  impact: { period: string; metrics: ImpactMetrics; computedAt: string };
}

export interface TimelineStep {
  status: string;
  label: string;
  state: 'done' | 'current' | 'upcoming';
}

export interface LearnerRequestCard {
  id: string;
  categoryName: string;
  areaName: string;
  status: string;
  /** Declined, Expired, Cancelled or Unmatched: shown as a note beside the timeline. */
  note: string | null;
  createdAt: string;
  timeline: TimelineStep[];
}

export interface PendingOfferDto {
  enrollmentId: string;
  offeringId: string;
  offeringTitle: string;
  spaceName: string | null;
  areaName: string | null;
  session: string | null;
  distanceKm: number | null;
  expiresAt: string | null;
}

export interface LearnerDashboard {
  role: 'Learner';
  requests: LearnerRequestCard[];
  pendingOffers: PendingOfferDto[];
  recommended: DiscoverOffering[];
  nearbyOffers: number;
}

export interface UpcomingSessionDto {
  scheduleId: string;
  date: string;
  startTime: string;
  endTime: string;
  spaceName: string;
  courseTitle: string;
}

export interface PendingApprovalDto {
  allocationId: string;
  courseTitle: string;
  spaceName: string;
  session: string;
  headcount: number;
  score: number;
  createdAt: string;
}

export interface OpenIssueDto {
  id: string;
  spaceName: string;
  facilityName: string;
  affectedQuantity: number;
  createdAt: string;
}

export interface SpaceGiverDashboard {
  role: 'SpaceGiver';
  utilisation: { spaces: SpaceUsageRow[]; byWeekday: WeekdayUsage[]; totals: SpaceGiverAnalytics['totals'] };
  upcomingSessions: UpcomingSessionDto[];
  pendingApprovals: PendingApprovalDto[];
  unusedHours: number;
  nearbyDemand: AreaDemandDto[];
  openIssues: OpenIssueDto[];
}

export interface ProviderOfferingCard {
  offeringId: string;
  title: string;
  status: string;
  batchSize: number;
  acceptedLearners: number;
  assigned: { allocationId: string; allocationStatus: string; spaceName: string; areaName: string; session: string } | null;
}

export interface ProviderDashboard {
  role: 'CourseProvider';
  offerings: ProviderOfferingCard[];
  acceptedLearners: number;
  highDemandAreas: HighDemandArea[];
  attendanceRate: number | null;
}

export type DashboardResponse = AdminDashboard | LearnerDashboard | SpaceGiverDashboard | ProviderDashboard;
