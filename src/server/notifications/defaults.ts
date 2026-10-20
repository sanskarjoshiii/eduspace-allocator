import type { NotificationType, Role } from '@/lib/domain';

export interface TemplateSeed {
  type: NotificationType;
  role: Role;
  titleTemplate: string;
  bodyTemplate: string;
  sendEmail?: boolean;
}

/**
 * Default notification templates (README section 14). Seeded into
 * notificationTemplates; Administrators edit them without a redeploy.
 */
export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  { type: 'request.received', role: 'Learner', titleTemplate: 'Request received', bodyTemplate: 'Your {{categoryName}} request was received and is being matched.' },
  { type: 'request.unmatched', role: 'Learner', titleTemplate: 'No class yet for {{categoryName}}', bodyTemplate: 'We could not place you in a {{categoryName}} class yet. Your request stays open, and we found {{suggestionCount}} options you might like.' },

  { type: 'allocation.proposed', role: 'SpaceGiver', titleTemplate: 'Class proposed at {{spaceName}}', bodyTemplate: '{{courseTitle}} is proposed at {{spaceName}}, {{session}}, for about {{headcount}} learners.' },
  { type: 'allocation.proposed', role: 'CourseProvider', titleTemplate: 'Space proposed for {{courseTitle}}', bodyTemplate: '{{courseTitle}} is proposed at {{spaceName}} ({{areaName}}), {{session}}. Cohort of {{headcount}} learners.' },
  { type: 'allocation.approvalNeeded', role: 'SpaceGiver', titleTemplate: 'Approval required', bodyTemplate: '{{courseTitle}} wants {{spaceName}} on {{session}}. Your space needs manual approval.' },
  { type: 'allocation.approved', role: 'CourseProvider', titleTemplate: 'Space approved', bodyTemplate: '{{spaceName}} approved {{courseTitle}} for {{session}}{{approvalNote}}. Confirm to send offers to learners.' },
  { type: 'allocation.approved', role: 'SpaceGiver', titleTemplate: 'Approved under your policy', bodyTemplate: '{{courseTitle}} on {{session}} at {{spaceName}} was approved automatically under your policy.' },
  { type: 'allocation.confirmed', role: 'SpaceGiver', titleTemplate: 'Class confirmed', bodyTemplate: '{{courseTitle}} is confirmed at {{spaceName}}, {{session}}.' },
  { type: 'allocation.rejected', role: 'CourseProvider', titleTemplate: 'Space declined', bodyTemplate: '{{spaceName}} declined {{courseTitle}}. Smart Allocation will look for another space.' },

  { type: 'offer.sent', role: 'Learner', titleTemplate: 'You have a seat in {{courseTitle}}', bodyTemplate: 'Your seat at {{spaceName}} ({{distance}} away), {{session}}, is held until {{expiresAt}}.', sendEmail: true },
  { type: 'offer.expiring', role: 'Learner', titleTemplate: 'Offer expires soon', bodyTemplate: 'Your seat in {{courseTitle}} is held until {{expiresAt}}. Accept it to keep it.', sendEmail: true },
  { type: 'offer.accepted', role: 'CourseProvider', titleTemplate: 'Learner accepted', bodyTemplate: '{{learnerName}} accepted a seat in {{courseTitle}}. {{seatsTaken}} of {{batchSize}} seats taken.' },
  { type: 'offer.declined', role: 'CourseProvider', titleTemplate: 'Learner declined', bodyTemplate: 'A learner declined {{courseTitle}}. The seat goes to the next waitlisted learner.' },
  { type: 'offer.expired', role: 'Learner', titleTemplate: 'Offer expired', bodyTemplate: 'Your offer for {{courseTitle}} expired and the seat went to the next learner. Submit a new request if you are still interested.' },
  { type: 'waitlist.promoted', role: 'Learner', titleTemplate: 'A seat opened up', bodyTemplate: 'A seat in {{courseTitle}} is now yours to accept, held until {{expiresAt}}.', sendEmail: true },

  { type: 'schedule.created', role: 'Learner', titleTemplate: 'Your class is scheduled', bodyTemplate: '{{courseTitle}} starts {{startDate}} at {{spaceName}}, {{session}}.' },
  { type: 'schedule.created', role: 'CourseProvider', titleTemplate: 'Schedule created', bodyTemplate: '{{sessionCount}} sessions of {{courseTitle}} are scheduled at {{spaceName}} from {{startDate}}.' },
  { type: 'schedule.created', role: 'SpaceGiver', titleTemplate: 'Sessions booked', bodyTemplate: '{{sessionCount}} sessions of {{courseTitle}} are booked at {{spaceName}}, {{session}}.' },
  { type: 'schedule.changed', role: 'Learner', titleTemplate: 'Class changed', bodyTemplate: '{{courseTitle}}: {{change}}' },
  { type: 'schedule.changed', role: 'CourseProvider', titleTemplate: 'Schedule changed', bodyTemplate: '{{courseTitle}}: {{change}}' },
  { type: 'schedule.changed', role: 'SpaceGiver', titleTemplate: 'Booking changed', bodyTemplate: '{{courseTitle}} at {{spaceName}}: {{change}}' },
  { type: 'schedule.clash', role: 'Administrator', titleTemplate: 'Schedule clash', bodyTemplate: '{{courseTitle}} clashes with another booking at {{spaceName}} on {{date}}.' },
  { type: 'schedule.clash', role: 'CourseProvider', titleTemplate: 'Schedule clash', bodyTemplate: '{{courseTitle}} clashes with another booking at {{spaceName}} on {{date}}. We flagged it for review.' },

  { type: 'demand.alert', role: 'SpaceGiver', titleTemplate: 'Demand for {{categoryName}} near you', bodyTemplate: '{{areaCount}} areas near {{anchorArea}} have {{requestCount}} open requests for {{categoryName}}. You have {{freeSlot}} free.' },
  { type: 'demand.alert', role: 'CourseProvider', titleTemplate: 'Demand for {{categoryName}}', bodyTemplate: '{{areaCount}} areas near {{anchorArea}} have {{requestCount}} open requests for {{categoryName}} and no confirmed class.' },

  { type: 'facility.issueReported', role: 'Administrator', titleTemplate: 'Facility issue at {{spaceName}}', bodyTemplate: '{{quantity}} {{facilityName}} down at {{spaceName}}. {{affectedCount}} allocations need another space.' },
  { type: 'facility.issueReported', role: 'CourseProvider', titleTemplate: 'Facility issue at your space', bodyTemplate: '{{quantity}} {{facilityName}} are down at {{spaceName}}. Alternatives are being found for {{courseTitle}}.' },
  { type: 'facility.issueReported', role: 'Learner', titleTemplate: 'Your class may move', bodyTemplate: 'Some equipment at {{spaceName}} is down. We are finding an alternative for {{courseTitle}}.' },
  { type: 'reallocation.proposed', role: 'CourseProvider', titleTemplate: 'Alternative space found', bodyTemplate: '{{newSpaceName}} is {{distance}} away and free {{session}} for {{courseTitle}}. Confirm to move the class.' },
  { type: 'reallocation.proposed', role: 'SpaceGiver', titleTemplate: 'Class proposed at {{newSpaceName}}', bodyTemplate: '{{courseTitle}} needs a new space and {{newSpaceName}} fits, {{session}}.' },
  { type: 'reallocation.proposed', role: 'Learner', titleTemplate: 'Your class may move', bodyTemplate: '{{courseTitle}} may move to {{newSpaceName}}, {{session}}. You will hear once it is confirmed.' },
  { type: 'reallocation.proposed', role: 'Administrator', titleTemplate: 'Reallocation proposed', bodyTemplate: '{{courseTitle}}: {{newSpaceName}} proposed to replace {{oldSpaceName}}.' },

  { type: 'course.completed', role: 'Learner', titleTemplate: 'Rate {{courseTitle}}', bodyTemplate: 'Your course has finished. Please rate it so others can choose well.' },
  { type: 'run.failed', role: 'Administrator', titleTemplate: 'Allocation run failed', bodyTemplate: 'Run {{runRef}} failed: {{error}}. {{retryNote}}' },
  { type: 'account.created', role: 'Administrator', titleTemplate: 'New {{roleLabel}} account', bodyTemplate: '{{name}} registered as a {{roleLabel}}{{approvalNote}}.' },
];
