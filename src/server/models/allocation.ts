import { Schema } from 'mongoose';
import { ALLOCATION_STATUSES, DEMAND_LEVELS, ENROLLMENT_STATUSES, RUN_STATUSES, RUN_TRIGGERS, SCHEDULE_STATUSES, STRATEGIES } from '@/lib/domain';
import { StatusHistorySchema, WindowSchema, defineModel } from './common';

const AllocationRunSchema = new Schema(
  {
    trigger: { type: String, enum: RUN_TRIGGERS, required: true },
    status: { type: String, enum: RUN_STATUSES, default: 'Queued', index: true },
    strategy: { type: String, enum: STRATEGIES, required: true },
    triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    /** Engine metrics for the optimised result (RunMetrics). */
    metrics: { type: Schema.Types.Mixed, default: null },
    /** Same metrics for the greedy nearest-space baseline on the same snapshot. */
    baselineMetrics: { type: Schema.Types.Mixed, default: null },
    /** Resumable phases: snapshot → engine → publish → notify → done. */
    partitionState: {
      phase: { type: String, default: 'queued' },
      attempts: { type: Number, default: 0 },
      completedPhases: { type: [String], default: [] },
    },
    eventIds: { type: [Schema.Types.ObjectId], default: [] },
    k: { type: Number, default: null },
    silhouette: { type: Number, default: null },
    counts: { type: Schema.Types.Mixed, default: null },
    decisionSummary: { type: String, default: '' },
    error: { type: String, default: '' },
    retryOf: { type: Schema.Types.ObjectId, ref: 'AllocationRun', default: null },
  },
  { timestamps: true },
);
export const AllocationRun = defineModel('AllocationRun', AllocationRunSchema);

const BreakdownSchema = new Schema(
  {
    criterion: { type: String, required: true },
    score: { type: Number, required: true },
    weight: { type: Number, required: true },
    weighted: { type: Number, required: true },
    detail: { type: String, default: '' },
  },
  { _id: false },
);

const ConstraintResultSchema = new Schema(
  {
    constraint: { type: String, required: true },
    passed: { type: Boolean, required: true },
    detail: { type: String, default: '' },
  },
  { _id: false },
);

const RejectedSchema = new Schema(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    spaceName: { type: String, default: '' },
    session: { type: WindowSchema, default: null },
    failedConstraint: { type: String, default: null },
    reason: { type: String, default: '' },
    score: { type: Number, default: null },
    distanceKm: { type: Number, default: null },
  },
  { _id: false },
);

const AllocationSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'AllocationRun', default: null, index: true },
    offeringId: { type: Schema.Types.ObjectId, ref: 'CourseOffering', required: true, index: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true, index: true },
    // Denormalised owners for fast role scoping.
    providerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    spaceOwnerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** The one weekly session this allocation books. */
    session: { type: WindowSchema, required: true },
    score: { type: Number, required: true },
    distanceKm: { type: Number, default: null },
    scoreBreakdown: { type: [BreakdownSchema], default: [] },
    constraints: { type: [ConstraintResultSchema], default: [] },
    rejectedAlternatives: { type: [RejectedSchema], default: [] },
    strategy: { type: String, enum: STRATEGIES, required: true },
    status: { type: String, enum: ALLOCATION_STATUSES, default: 'Proposed', index: true },
    statusHistory: { type: [StatusHistorySchema], default: [] },
    /** Set when this is a reallocation proposal replacing another allocation. */
    replacesAllocationId: { type: Schema.Types.ObjectId, ref: 'Allocation', default: null },
    approvedAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    overrideNote: { type: String, default: '' },
  },
  { timestamps: true },
);
AllocationSchema.index({ spaceId: 1, 'session.dayOfWeek': 1, status: 1 });
export const Allocation = defineModel('Allocation', AllocationSchema);

const EnrollmentSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'LearningRequest', required: true, index: true },
    learnerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    offeringId: { type: Schema.Types.ObjectId, ref: 'CourseOffering', required: true, index: true },
    /** Null while waitlisted for an offering that has no allocation yet. */
    allocationId: { type: Schema.Types.ObjectId, ref: 'Allocation', default: null, index: true },
    runId: { type: Schema.Types.ObjectId, ref: 'AllocationRun', default: null },
    status: { type: String, enum: ENROLLMENT_STATUSES, required: true, index: true },
    statusHistory: { type: [StatusHistorySchema], default: [] },
    offerExpiresAt: { type: Date, default: null },
    expiringNotifiedAt: { type: Date, default: null },
    score: { type: Number, default: null },
    distanceKm: { type: Number, default: null },
    waitlistRank: { type: Number, default: null },
    secondBest: {
      type: new Schema({ offeringId: { type: Schema.Types.ObjectId, ref: 'CourseOffering' }, score: Number }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true },
);
EnrollmentSchema.index({ status: 1, offerExpiresAt: 1 });
export const Enrollment = defineModel('Enrollment', EnrollmentSchema);

const ScheduleSchema = new Schema(
  {
    allocationId: { type: Schema.Types.ObjectId, ref: 'Allocation', required: true, index: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    offeringId: { type: Schema.Types.ObjectId, ref: 'CourseOffering', required: true },
    /** IST calendar date of the session, stored as UTC midnight of that date. */
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    status: { type: String, enum: SCHEDULE_STATUSES, default: 'Planned' },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);
ScheduleSchema.index({ spaceId: 1, date: 1 });
export const Schedule = defineModel('Schedule', ScheduleSchema);

const DemandInsightSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'AllocationRun', default: null },
    areaId: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CourseCategory', required: true },
    level: { type: String, enum: DEMAND_LEVELS, required: true },
    demand: { type: Number, required: true },
    seatsOffered: { type: Number, required: true },
    gap: { type: Number, required: true },
    computedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);
DemandInsightSchema.index({ areaId: 1, categoryId: 1 }, { unique: true });
export const DemandInsight = defineModel('DemandInsight', DemandInsightSchema);
