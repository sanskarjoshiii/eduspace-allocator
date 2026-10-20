// Stage-based learner redaction (README section 6). This is the only place that
// decides what learner data another role may see. Route handlers must pass every
// learner-bearing record through these mappers.

import type { Role } from '@/lib/domain';

/** How far a learner's request has progressed with the viewer's offering or space. */
export type DisclosureStage = 'beforeMatching' | 'proposed' | 'accepted';

export interface LearnerSource {
  requestId: string;
  learnerUserId: string;
  name: string;
  ageBand: string;
  contactPhone: string;
  contactEmail: string;
  accessibilityNeeds: string[];
  areaId: string;
  areaName: string;
  /** Area centre, [lng, lat]. Shown to everyone who may see a location. */
  areaCenter: [number, number];
  /** Exact point, [lng, lat]. Only the learner themself and administrators. */
  location: [number, number];
  categoryName: string;
  windows: { dayOfWeek: number; startTime: string; endTime: string }[];
  startMonth: string;
  durationMonths: number;
  status: string;
}

export interface Viewer {
  id: string;
  role: Role;
}

/** Full view: the learner themself and administrators. */
export interface LearnerFullView extends Omit<LearnerSource, 'location'> {
  visibility: 'full';
  location: [number, number];
}
/** Provider after the learner accepted: identity and contact, area centre only. */
export interface LearnerProviderView {
  visibility: 'provider-accepted';
  requestId: string;
  name: string;
  ageBand: string;
  contactPhone: string;
  contactEmail: string;
  accessibilityNeeds: string[];
  areaName: string;
  areaCenter: [number, number];
  categoryName: string;
  windows: LearnerSource['windows'];
  startMonth: string;
  durationMonths: number;
}
/** Space giver after the learner accepted: a name for the entry roster, nothing else. */
export interface LearnerRosterView {
  visibility: 'roster';
  requestId: string;
  name: string;
}
/** Proposed stage: no identity, only what a cohort summary needs. */
export interface LearnerCohortView {
  visibility: 'cohort';
  requestId: string;
  areaName: string;
  areaCenter: [number, number];
  windows: LearnerSource['windows'];
}

export type LearnerView = LearnerFullView | LearnerProviderView | LearnerRosterView | LearnerCohortView;

/**
 * Maps a learner record for a viewer.
 * - The learner and administrators see everything.
 * - Course providers see contact details only once the learner accepted; before that, a cohort entry.
 * - Space givers never see contact details: a roster name after acceptance, a cohort entry before.
 * - Before matching, no one else sees individual learners at all (returns null; use aggregates).
 */
export function learnerViewFor(
  viewer: Viewer,
  src: LearnerSource,
  stage: DisclosureStage,
  relation: 'provider' | 'spaceGiver' | 'none',
): LearnerView | null {
  if (viewer.role === 'Administrator' || viewer.id === src.learnerUserId) {
    return { ...src, visibility: 'full' };
  }
  if (stage === 'beforeMatching' || relation === 'none') return null;
  if (stage === 'proposed') {
    return { visibility: 'cohort', requestId: src.requestId, areaName: src.areaName, areaCenter: src.areaCenter, windows: src.windows };
  }
  if (relation === 'provider' && viewer.role === 'CourseProvider') {
    return {
      visibility: 'provider-accepted',
      requestId: src.requestId,
      name: src.name,
      ageBand: src.ageBand,
      contactPhone: src.contactPhone,
      contactEmail: src.contactEmail,
      accessibilityNeeds: src.accessibilityNeeds,
      areaName: src.areaName,
      areaCenter: src.areaCenter,
      categoryName: src.categoryName,
      windows: src.windows,
      startMonth: src.startMonth,
      durationMonths: src.durationMonths,
    };
  }
  if (relation === 'spaceGiver' && viewer.role === 'SpaceGiver') {
    return { visibility: 'roster', requestId: src.requestId, name: src.name };
  }
  return null;
}

/** Disclosure stage from an enrollment status. */
export function stageFromEnrollment(status: string | null | undefined): DisclosureStage {
  if (status === 'Accepted') return 'accepted';
  if (status === 'Proposed' || status === 'Offered' || status === 'Waitlisted') return 'proposed';
  return 'beforeMatching';
}

/**
 * Location a viewer may see for a learner: the exact point for the learner and
 * administrators, the area centre for everyone else (F-29).
 */
export function visibleLearnerPoint(viewer: Viewer, learnerUserId: string, exact: [number, number], areaCenter: [number, number]): [number, number] {
  return viewer.role === 'Administrator' || viewer.id === learnerUserId ? exact : areaCenter;
}
