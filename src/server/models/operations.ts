import { Schema } from 'mongoose';
import { FACILITY_ISSUE_STATUSES } from '@/lib/domain';
import { defineModel } from './common';

const AttendanceSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    scheduleId: { type: Schema.Types.ObjectId, ref: 'Schedule', default: null },
    allocationId: { type: Schema.Types.ObjectId, ref: 'Allocation', required: true, index: true },
    sessionDate: { type: Date, required: true },
    present: { type: Boolean, required: true },
    markedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
AttendanceSchema.index({ enrollmentId: 1, sessionDate: 1 }, { unique: true });
export const AttendanceRecord = defineModel('AttendanceRecord', AttendanceSchema);

const FeedbackSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true, unique: true },
    learnerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    offeringId: { type: Schema.Types.ObjectId, ref: 'CourseOffering', required: true, index: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, default: '', maxlength: 2000 },
  },
  { timestamps: true },
);
export const Feedback = defineModel('Feedback', FeedbackSchema);

const FacilityIssueSchema = new Schema(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true, index: true },
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    facilityTypeId: { type: Schema.Types.ObjectId, ref: 'FacilityType', required: true },
    affectedQuantity: { type: Number, min: 1, required: true },
    description: { type: String, default: '' },
    evidenceUrl: { type: String, default: '' },
    status: { type: String, enum: FACILITY_ISSUE_STATUSES, default: 'Open', index: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Allocations that failed the re-check and were marked Needs reallocation. */
    affectedAllocationIds: { type: [Schema.Types.ObjectId], ref: 'Allocation', default: [] },
  },
  { timestamps: true },
);
export const FacilityIssue = defineModel('FacilityIssue', FacilityIssueSchema);

const SocialImpactSchema = new Schema(
  {
    /** "YYYY-MM" */
    period: { type: String, required: true, unique: true },
    metrics: {
      learnersServed: { type: Number, default: 0 },
      learningHours: { type: Number, default: 0 },
      providersWithVenue: { type: Number, default: 0 },
      sessionsScheduled: { type: Number, default: 0 },
      spacesUsed: { type: Number, default: 0 },
      idleHoursUsed: { type: Number, default: 0 },
      areasReached: { type: Number, default: 0 },
      highDemandAreasServed: { type: Number, default: 0 },
      avgDistanceKm: { type: Number, default: 0 },
      spaceUtilisation: { type: Number, default: 0 },
      activeSpaceGivers: { type: Number, default: 0 },
      activeProviders: { type: Number, default: 0 },
      ngoPartners: { type: Number, default: 0 },
    },
    computedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);
export const SocialImpact = defineModel('SocialImpact', SocialImpactSchema);
