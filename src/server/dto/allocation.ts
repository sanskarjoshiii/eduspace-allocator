import { ALLOCATION_LABEL, type AllocationStatus, type ApprovalMode, type Audience, type EnrollmentStatus, type Strategy } from '@/lib/domain';
import { formatWindow } from '@/lib/format';
import type { LearnerView } from './privacy';
import type { ScheduleDto } from './schedule';
import type { AllocationLean, WindowDoc } from '@/server/worker/types';

export interface SeatCountsDto {
  batchSize: number;
  proposed: number;
  offered: number;
  accepted: number;
  waitlisted: number;
  /** proposed + offered + accepted */
  taken: number;
}

export interface AllocationListItemDto {
  id: string;
  runId: string | null;
  offeringId: string;
  courseTitle: string;
  categoryName: string;
  spaceId: string;
  spaceName: string;
  areaName: string;
  session: WindowDoc;
  sessionLabel: string;
  /** Compatibility score 0..1 (never a probability). */
  score: number;
  distanceKm: number | null;
  status: AllocationStatus;
  statusLabel: string;
  strategy: Strategy;
  approvalMode: ApprovalMode;
  replacesAllocationId: string | null;
  approvedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  seats: SeatCountsDto;
}

/** What a learner sees of an allocation they hold a place on. */
export interface LearnerAllocationDto {
  id: string;
  courseTitle: string;
  spaceName: string;
  areaName: string;
  session: WindowDoc;
  sessionLabel: string;
  status: AllocationStatus;
  statusLabel: string;
  myEnrollment: { id: string; status: EnrollmentStatus; offerExpiresAt: string | null; waitlistRank: number | null } | null;
}

export interface AllocationDetailDto extends AllocationListItemDto {
  offering: {
    id: string;
    title: string;
    categoryName: string;
    audience: Audience;
    batchSize: number;
    sessionMinutes: number;
    durationWeeks: number;
    startDate: string;
  };
  space: {
    id: string;
    name: string;
    address: string;
    areaName: string;
    /** [lng, lat] — spaces are public. */
    location: [number, number];
    seatCapacity: number;
    approvalMode: ApprovalMode;
  };
  providerName: string;
  spaceGiverName: string;
  breakdown: AllocationLean['scoreBreakdown'];
  constraints: AllocationLean['constraints'];
  rejectedAlternatives: {
    spaceId: string;
    spaceName: string;
    session: WindowDoc | null;
    sessionLabel: string;
    failedConstraint: string | null;
    reason: string;
    score: number | null;
    distanceKm: number | null;
  }[];
  statusHistory: { status: string; label: string; at: string; note: string }[];
  overrideNote: string;
  /** Cohort as the viewer may see it (identities only through learnerViewFor). Null for learners. */
  cohort: {
    headcount: number;
    byArea: { areaName: string; count: number }[];
    learners: LearnerView[];
  } | null;
  schedules: ScheduleDto[];
  /** Replacement proposals for this allocation (reallocation), newest first. */
  replacements: { id: string; spaceName: string; status: AllocationStatus }[];
  /** What the viewer may do next. */
  actions: { approve: boolean; reject: boolean; confirm: boolean; override: boolean };
}

export interface AllocationRefs {
  courseTitle: string;
  categoryName: string;
  spaceName: string;
  areaName: string;
  approvalMode: ApprovalMode;
  seats: SeatCountsDto;
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export function toAllocationListItem(a: AllocationLean, r: AllocationRefs): AllocationListItemDto {
  return {
    id: a._id.toString(),
    runId: a.runId ? a.runId.toString() : null,
    offeringId: a.offeringId.toString(),
    courseTitle: r.courseTitle,
    categoryName: r.categoryName,
    spaceId: a.spaceId.toString(),
    spaceName: r.spaceName,
    areaName: r.areaName,
    session: { dayOfWeek: a.session.dayOfWeek, startTime: a.session.startTime, endTime: a.session.endTime },
    sessionLabel: formatWindow(a.session),
    score: a.score,
    distanceKm: a.distanceKm ?? null,
    status: a.status,
    statusLabel: ALLOCATION_LABEL[a.status],
    strategy: a.strategy,
    approvalMode: r.approvalMode,
    replacesAllocationId: a.replacesAllocationId ? a.replacesAllocationId.toString() : null,
    approvedAt: iso(a.approvedAt),
    confirmedAt: iso(a.confirmedAt),
    createdAt: iso(a.createdAt) ?? '',
    seats: r.seats,
  };
}
