// Shared domain vocabulary. Safe to import from client and server code.

export const ROLES = ['Administrator', 'Learner', 'SpaceGiver', 'CourseProvider'] as const;
export type Role = (typeof ROLES)[number];
export const SELF_REGISTER_ROLES = ['Learner', 'SpaceGiver', 'CourseProvider'] as const satisfies readonly Role[];
export const ROLE_LABEL: Record<Role, string> = {
  Administrator: 'Administrator',
  Learner: 'Learner',
  SpaceGiver: 'Space Giver',
  CourseProvider: 'Course Provider',
};

export const USER_STATUSES = ['Active', 'PendingApproval', 'Suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** 0 = Sunday … 6 = Saturday, matching Date.getDay(). */
export const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type DayOfWeek = (typeof DAYS)[number];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const AGE_BANDS = ['Under 13', '13-17', '18-24', '25-40', '41-60', '60+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const AUDIENCES = ['Children', 'Teens', 'Adults', 'Seniors'] as const;
export type Audience = (typeof AUDIENCES)[number];
export function audienceForAgeBand(band: AgeBand): Audience {
  if (band === 'Under 13') return 'Children';
  if (band === '13-17') return 'Teens';
  if (band === '60+') return 'Seniors';
  return 'Adults';
}

export const INCOME_GROUPS = ['Low', 'Medium', 'High'] as const;
export type IncomeGroup = (typeof INCOME_GROUPS)[number];

export const PARTNER_TYPES = ['SpaceGiverOrg', 'ProviderOrg', 'IndividualTutor'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const APPROVAL_MODES = ['auto', 'manual'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const DEMAND_LEVELS = ['High', 'Medium', 'Emerging'] as const;
export type DemandLevel = (typeof DEMAND_LEVELS)[number];

export const STRATEGIES = ['balanced', 'accessibility', 'reach', 'cost'] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const STRATEGY_LABEL: Record<Strategy, string> = {
  balanced: 'Balanced',
  accessibility: 'Accessibility first',
  reach: 'Maximum reach',
  cost: 'Cost efficient',
};

// ---- Lifecycles (README section 8, plus the additions in section 25) ----

export const REQUEST_STATUSES = [
  'Submitted', 'Analysed', 'Unmatched', 'Matched', 'Waitlisted', 'Offered', 'Accepted',
  'Scheduled', 'Active', 'Completed', 'Declined', 'Expired', 'Cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Requests the engine still tries to place. */
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ['Submitted', 'Analysed', 'Unmatched', 'Matched'];

export const OFFERING_STATUSES = ['Draft', 'Open', 'Allocated', 'Active', 'Completed', 'Cancelled'] as const;
export type OfferingStatus = (typeof OFFERING_STATUSES)[number];

export const ALLOCATION_STATUSES = [
  'Proposed', 'ApprovedBySpace', 'ConfirmedByProvider', 'Scheduled', 'Active', 'Completed',
  'Rejected', 'Cancelled', 'NeedsReallocation', 'Superseded',
] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];
export const ALLOCATION_LABEL: Record<AllocationStatus, string> = {
  Proposed: 'Proposed',
  ApprovedBySpace: 'Approved',
  ConfirmedByProvider: 'Confirmed',
  Scheduled: 'Scheduled',
  Active: 'Active',
  Completed: 'Completed',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
  NeedsReallocation: 'Needs reallocation',
  Superseded: 'Superseded',
};
/** Allocations that hold a space slot (count as bookings for clash checks). */
export const BOOKING_ALLOCATION_STATUSES: readonly AllocationStatus[] = [
  'ApprovedBySpace', 'ConfirmedByProvider', 'Scheduled', 'Active', 'NeedsReallocation',
];
/** Allocations the engine may replace on a re-run. */
export const REOPTIMISABLE_ALLOCATION_STATUSES: readonly AllocationStatus[] = ['Proposed'];

export const ALLOCATION_TRANSITIONS: Record<AllocationStatus, readonly AllocationStatus[]> = {
  Proposed: ['ApprovedBySpace', 'Rejected', 'Superseded', 'Cancelled'],
  ApprovedBySpace: ['ConfirmedByProvider', 'Rejected', 'Cancelled', 'NeedsReallocation'],
  ConfirmedByProvider: ['Scheduled', 'Cancelled', 'NeedsReallocation'],
  Scheduled: ['Active', 'Cancelled', 'NeedsReallocation'],
  Active: ['Completed', 'NeedsReallocation', 'Cancelled'],
  NeedsReallocation: ['Proposed', 'Cancelled', 'ConfirmedByProvider', 'Scheduled', 'Active'],
  Completed: [],
  Rejected: [],
  Cancelled: [],
  Superseded: [],
};

/**
 * Enrollment states. "Proposed" is an internal addition: the seat is held while the
 * space approves and the provider confirms; it becomes "Offered" (with expiry) on confirmation.
 */
export const ENROLLMENT_STATUSES = ['Proposed', 'Offered', 'Accepted', 'Declined', 'Waitlisted', 'Expired', 'Cancelled'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const ENROLLMENT_TRANSITIONS: Record<EnrollmentStatus, readonly EnrollmentStatus[]> = {
  Proposed: ['Offered', 'Cancelled', 'Waitlisted'],
  Offered: ['Accepted', 'Declined', 'Expired', 'Cancelled'],
  Waitlisted: ['Offered', 'Proposed', 'Cancelled'],
  Accepted: ['Cancelled'],
  Declined: [],
  Expired: [],
  Cancelled: [],
};
/** Enrollments that occupy a seat. */
export const SEAT_HOLDING_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['Proposed', 'Offered', 'Accepted'];

export function canTransition<S extends string>(map: Record<S, readonly S[]>, from: S, to: S): boolean {
  return map[from]?.includes(to) ?? false;
}

export const SCHEDULE_STATUSES = ['Planned', 'Held', 'Cancelled', 'Moved'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const RUN_STATUSES = ['Queued', 'Running', 'Completed', 'Failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_TRIGGERS = ['event', 'manual', 'nightly', 'reallocation'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const FACILITY_ISSUE_STATUSES = ['Open', 'Resolved'] as const;
export type FacilityIssueStatus = (typeof FACILITY_ISSUE_STATUSES)[number];

export const DOMAIN_EVENT_TYPES = [
  'space.saved', 'space.deleted', 'offering.saved', 'offering.deleted', 'request.saved', 'request.cancelled',
  'facilityIssue.reported', 'facilityIssue.resolved', 'enrollment.released', 'manual.trigger',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'request.received',
  'allocation.proposed',
  'allocation.approvalNeeded',
  'allocation.approved',
  'allocation.confirmed',
  'allocation.rejected',
  'offer.sent',
  'offer.expiring',
  'offer.accepted',
  'offer.declined',
  'offer.expired',
  'waitlist.promoted',
  'schedule.created',
  'schedule.changed',
  'schedule.clash',
  'demand.alert',
  'facility.issueReported',
  'reallocation.proposed',
  'course.completed',
  'run.failed',
  'request.unmatched',
  'account.created',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Tone of a status badge, from the design system's status vocabulary. */
export type Tone = 'neutral' | 'accent' | 'success' | 'info' | 'warning' | 'danger';
export const STATUS_TONE: Record<string, Tone> = {
  // enrollment
  Proposed: 'info', Offered: 'accent', Accepted: 'success', Waitlisted: 'info', Expired: 'warning', Declined: 'neutral', Cancelled: 'neutral',
  // allocation
  ApprovedBySpace: 'accent', ConfirmedByProvider: 'success', Scheduled: 'success', Active: 'success', Completed: 'neutral',
  Rejected: 'danger', NeedsReallocation: 'danger', Superseded: 'neutral',
  // request
  Submitted: 'neutral', Analysed: 'info', Unmatched: 'warning', Matched: 'info',
  // demand
  High: 'accent', Medium: 'info', Emerging: 'success',
  // run
  Queued: 'neutral', Running: 'info', Failed: 'danger',
  // offering
  Draft: 'neutral', Open: 'info', Allocated: 'accent',
  // misc (facility issues reuse "Open": pass tone="warning" explicitly there)
  Resolved: 'success', Planned: 'info', Held: 'success', Moved: 'warning',
  PendingApproval: 'warning', Suspended: 'danger',
};
