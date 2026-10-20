// Lean document shapes used by the worker and the allocation services. Mongoose's
// inferred types are loose for nested arrays, so reads use `.lean<T>()` with these.

import type { Types } from 'mongoose';
import type {
  AllocationStatus,
  EnrollmentStatus,
  FacilityIssueStatus,
  OfferingStatus,
  RequestStatus,
  RunStatus,
  RunTrigger,
  ScheduleStatus,
  Strategy,
} from '@/lib/domain';

type Id = Types.ObjectId;

export interface WindowDoc {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface HistoryDoc {
  status: string;
  at: Date;
  by: Id | null;
  note: string;
}

export interface AllocationLean {
  _id: Id;
  runId: Id | null;
  offeringId: Id;
  spaceId: Id;
  providerUserId: Id;
  spaceOwnerUserId: Id;
  session: WindowDoc;
  score: number;
  distanceKm: number | null;
  scoreBreakdown: { criterion: string; score: number; weight: number; weighted: number; detail: string }[];
  constraints: { constraint: string; passed: boolean; detail: string }[];
  rejectedAlternatives: {
    spaceId: Id;
    spaceName: string;
    session: WindowDoc | null;
    failedConstraint: string | null;
    reason: string;
    score: number | null;
    distanceKm: number | null;
  }[];
  strategy: Strategy;
  status: AllocationStatus;
  statusHistory: HistoryDoc[];
  replacesAllocationId: Id | null;
  approvedAt: Date | null;
  confirmedAt: Date | null;
  overrideNote: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnrollmentLean {
  _id: Id;
  requestId: Id;
  learnerUserId: Id;
  offeringId: Id;
  allocationId: Id | null;
  runId: Id | null;
  status: EnrollmentStatus;
  statusHistory: HistoryDoc[];
  offerExpiresAt: Date | null;
  expiringNotifiedAt: Date | null;
  score: number | null;
  distanceKm: number | null;
  waitlistRank: number | null;
  secondBest: { offeringId: Id; score: number } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OfferingLean {
  _id: Id;
  courseId: Id;
  providerUserId: Id;
  title: string;
  categoryId: Id;
  audience: 'Children' | 'Teens' | 'Adults' | 'Seniors';
  batchSize: number;
  sessionMinutes: number;
  durationWeeks: number;
  startDate: Date;
  targetAreaId: Id | null;
  status: OfferingStatus;
  windows: WindowDoc[];
  maxRentPerHour: number | null;
  feePerMonth: number | null;
}

export interface SpaceLean {
  _id: Id;
  ownerUserId: Id;
  name: string;
  address: string;
  location: { type: 'Point'; coordinates: number[] };
  areaId: Id;
  isActive: boolean;
  seatCapacity: number;
  facilities: { facilityTypeId: Id; quantity: number; workingQuantity: number }[];
  slots: { _id: Id; dayOfWeek: number; startTime: string; endTime: string; isBlocked: boolean }[];
  policy: {
    allowedCategoryIds: Id[];
    allowedAudiences: ('Children' | 'Teens' | 'Adults' | 'Seniors')[];
    rentPerHour: number;
    approvalMode: 'auto' | 'manual';
    rules: string;
  };
}

export interface RequestLean {
  _id: Id;
  learnerUserId: Id;
  learnerProfileId: Id;
  categoryId: Id;
  areaId: Id;
  location: { type: 'Point'; coordinates: number[] };
  audience: 'Children' | 'Teens' | 'Adults' | 'Seniors';
  maxDistanceKm: number;
  startMonth: string;
  durationMonths: number;
  status: RequestStatus;
  windows: WindowDoc[];
  requiredFacilityTypeIds: Id[];
  budgetPerMonth: number | null;
  createdAt: Date;
}

export interface ScheduleLean {
  _id: Id;
  allocationId: Id;
  spaceId: Id;
  offeringId: Id;
  date: Date;
  startTime: string;
  endTime: string;
  status: ScheduleStatus;
  note: string;
}

export interface RunLean {
  _id: Id;
  trigger: RunTrigger;
  status: RunStatus;
  strategy: Strategy;
  triggeredBy: Id | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  metrics: Record<string, number> | null;
  baselineMetrics: Record<string, number> | null;
  partitionState: { phase: string; attempts: number; completedPhases: string[] };
  eventIds: Id[];
  k: number | null;
  silhouette: number | null;
  counts: Record<string, number> | null;
  decisionSummary: string;
  error: string;
  retryOf: Id | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FacilityIssueLean {
  _id: Id;
  spaceId: Id;
  reportedBy: Id;
  facilityTypeId: Id;
  affectedQuantity: number;
  description: string;
  evidenceUrl: string;
  status: FacilityIssueStatus;
  resolvedAt: Date | null;
  resolvedBy: Id | null;
  affectedAllocationIds: Id[];
  createdAt: Date;
  updatedAt: Date;
}
