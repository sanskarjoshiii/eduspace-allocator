import type { AllocationStatus, EnrollmentStatus } from '@/lib/domain';
import { formatWindow } from '@/lib/format';
import type { LearnerView } from './privacy';
import type { EnrollmentLean, WindowDoc } from '@/server/worker/types';

/** A learner's own enrollment with what the Offers page shows. */
export interface MyEnrollmentDto {
  id: string;
  status: EnrollmentStatus;
  requestId: string;
  offeringId: string;
  allocationId: string | null;
  allocationStatus: AllocationStatus | null;
  courseTitle: string;
  categoryName: string;
  providerName: string;
  spaceId: string | null;
  spaceName: string;
  spaceAddress: string;
  areaName: string;
  /** Space location [lng, lat] (public: spaces are visible platform-wide). */
  spaceLocation: [number, number] | null;
  session: WindowDoc | null;
  sessionLabel: string;
  startDate: string | null;
  durationWeeks: number | null;
  feePerMonth: number | null;
  /** ISO timestamp; set while Offered. */
  offerExpiresAt: string | null;
  /** Compatibility score 0..1 (never a probability). */
  score: number | null;
  distanceKm: number | null;
  waitlistRank: number | null;
  history: { status: string; at: string; note: string }[];
  createdAt: string;
}

export interface MyEnrollmentRefs {
  allocationStatus: AllocationStatus | null;
  courseTitle: string;
  categoryName: string;
  providerName: string;
  spaceId: string | null;
  spaceName: string;
  spaceAddress: string;
  areaName: string;
  spaceLocation: [number, number] | null;
  session: WindowDoc | null;
  startDate: Date | null;
  durationWeeks: number | null;
  feePerMonth: number | null;
}

export function toMyEnrollmentDto(e: EnrollmentLean, r: MyEnrollmentRefs): MyEnrollmentDto {
  return {
    id: e._id.toString(),
    status: e.status,
    requestId: e.requestId.toString(),
    offeringId: e.offeringId.toString(),
    allocationId: e.allocationId ? e.allocationId.toString() : null,
    allocationStatus: r.allocationStatus,
    courseTitle: r.courseTitle,
    categoryName: r.categoryName,
    providerName: r.providerName,
    spaceId: r.spaceId,
    spaceName: r.spaceName,
    spaceAddress: r.spaceAddress,
    areaName: r.areaName,
    spaceLocation: r.spaceLocation,
    session: r.session,
    sessionLabel: r.session ? formatWindow(r.session) : '',
    startDate: r.startDate ? new Date(r.startDate).toISOString() : null,
    durationWeeks: r.durationWeeks,
    feePerMonth: r.feePerMonth,
    offerExpiresAt: e.offerExpiresAt ? new Date(e.offerExpiresAt).toISOString() : null,
    score: e.score ?? null,
    distanceKm: e.distanceKm ?? null,
    waitlistRank: e.status === 'Waitlisted' ? (e.waitlistRank ?? null) : null,
    history: (e.statusHistory ?? []).map((h) => ({ status: h.status, at: new Date(h.at).toISOString(), note: h.note ?? '' })),
    createdAt: new Date(e.createdAt).toISOString(),
  };
}

/** One roster line. `learner` is whatever learnerViewFor allows the viewer to see (null = nothing). */
export interface RosterEntryDto {
  enrollmentId: string;
  status: EnrollmentStatus;
  waitlistRank: number | null;
  offerExpiresAt: string | null;
  learner: LearnerView | null;
}

export interface RosterDto {
  allocationId: string;
  batchSize: number;
  counts: { proposed: number; offered: number; accepted: number; waitlisted: number };
  entries: RosterEntryDto[];
}

/** Minimal result of accept / decline. */
export interface EnrollmentActionDto {
  id: string;
  status: EnrollmentStatus;
  requestStatus: string | null;
  allocationStatus: AllocationStatus | null;
}
