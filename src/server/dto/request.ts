// Learning request DTOs. The full DTO (with the exact location) is only ever built for
// the learner themself and administrators; matched parties get `MatchedRequestDto`,
// whose learner part comes from learnerViewFor in ./privacy (the only redaction logic).

import type { Audience, RequestStatus } from '@/lib/domain';
import { idStr, isoOrNull, lngLat, type IdLike } from './lookup';
import type { DisclosureStage, LearnerSource, LearnerView } from './privacy';

export interface RequestRecord {
  _id: IdLike;
  learnerUserId: IdLike;
  learnerProfileId: IdLike;
  categoryId: IdLike;
  areaId: IdLike;
  location: { coordinates?: number[] | null };
  audience: string;
  maxDistanceKm: number;
  startMonth: string;
  durationMonths: number;
  consentShared: boolean;
  consentAt: Date;
  status?: string | null;
  windows?: { dayOfWeek: number; startTime: string; endTime: string }[] | null;
  requiredFacilityTypeIds?: IdLike[] | null;
  budgetPerMonth?: number | null;
  notes?: string | null;
  suggestions?: { offeringId?: IdLike | null; categoryId: IdLike; areaId?: IdLike | null; score: number; reasons?: string[] | null }[] | null;
  lastRunId?: IdLike | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface TimelineEntry {
  status: string;
  at: string;
  source: 'request' | 'enrollment';
  note: string;
  offeringId: string | null;
}

export interface RequestFullDto {
  visibility: 'full';
  id: string;
  learnerUserId: string;
  learnerProfileId: string;
  learnerName: string | null;
  categoryId: string;
  categoryName: string | null;
  areaId: string;
  areaName: string | null;
  areaCenter: [number, number] | null;
  /** Exact point [lng, lat]. Learner and administrators only. */
  location: [number, number];
  audience: Audience;
  maxDistanceKm: number;
  startMonth: string;
  durationMonths: number;
  consentShared: boolean;
  consentAt: string | null;
  status: RequestStatus;
  windows: { dayOfWeek: number; startTime: string; endTime: string }[];
  requiredFacilityTypeIds: string[];
  budgetPerMonth: number | null;
  notes: string;
  suggestions: { offeringId: string | null; categoryId: string; areaId: string | null; score: number; reasons: string[] }[];
  lastRunId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Detail endpoint only. */
  statusTimeline?: TimelineEntry[];
}

/** A request as seen by a matched Course Provider or Space Giver. */
export interface MatchedRequestDto {
  visibility: 'matched';
  requestId: string;
  relation: 'provider' | 'spaceGiver';
  stage: DisclosureStage;
  enrollmentId: string;
  enrollmentStatus: string;
  offeringId: string;
  offeringTitle: string | null;
  /** Redacted by stage: cohort, provider-accepted or roster. Never the exact location. */
  learner: Exclude<LearnerView, { visibility: 'full' }>;
}

export type RequestDto = RequestFullDto | MatchedRequestDto;

export function requestFullDto(
  r: RequestRecord,
  extra: { learnerName?: string | null; categoryName?: string | null; areaName?: string | null; areaCenter?: [number, number] | null } = {},
): RequestFullDto {
  return {
    visibility: 'full',
    id: String(r._id),
    learnerUserId: String(r.learnerUserId),
    learnerProfileId: String(r.learnerProfileId),
    learnerName: extra.learnerName ?? null,
    categoryId: String(r.categoryId),
    categoryName: extra.categoryName ?? null,
    areaId: String(r.areaId),
    areaName: extra.areaName ?? null,
    areaCenter: extra.areaCenter ?? null,
    location: lngLat(r.location),
    audience: r.audience as Audience,
    maxDistanceKm: r.maxDistanceKm,
    startMonth: r.startMonth,
    durationMonths: r.durationMonths,
    consentShared: r.consentShared,
    consentAt: isoOrNull(r.consentAt),
    status: (r.status ?? 'Submitted') as RequestStatus,
    windows: (r.windows ?? []).map((w) => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
    requiredFacilityTypeIds: (r.requiredFacilityTypeIds ?? []).map(String),
    budgetPerMonth: r.budgetPerMonth ?? null,
    notes: r.notes ?? '',
    suggestions: (r.suggestions ?? []).map((s) => ({
      offeringId: idStr(s.offeringId),
      categoryId: String(s.categoryId),
      areaId: idStr(s.areaId),
      score: s.score,
      reasons: s.reasons ?? [],
    })),
    lastRunId: idStr(r.lastRunId),
    createdAt: isoOrNull(r.createdAt),
    updatedAt: isoOrNull(r.updatedAt),
  };
}

/** Builds the privacy module's LearnerSource from a request and its related records. */
export function learnerSourceOf(
  r: RequestRecord,
  profile: { name: string; ageBand: string; contactPhone?: string | null; contactEmail?: string | null; accessibilityNeeds?: string[] | null } | null,
  area: { name: string; center: { coordinates?: number[] | null } } | null,
  categoryName: string | null,
): LearnerSource {
  return {
    requestId: String(r._id),
    learnerUserId: String(r.learnerUserId),
    name: profile?.name ?? '',
    ageBand: profile?.ageBand ?? '',
    contactPhone: profile?.contactPhone ?? '',
    contactEmail: profile?.contactEmail ?? '',
    accessibilityNeeds: profile?.accessibilityNeeds ?? [],
    areaId: String(r.areaId),
    areaName: area?.name ?? '',
    areaCenter: area ? lngLat(area.center) : [0, 0],
    location: lngLat(r.location),
    categoryName: categoryName ?? '',
    windows: (r.windows ?? []).map((w) => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
    startMonth: r.startMonth,
    durationMonths: r.durationMonths,
    status: r.status ?? 'Submitted',
  };
}
