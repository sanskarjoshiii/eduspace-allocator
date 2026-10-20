import { Schema } from 'mongoose';
import { APPROVAL_MODES, AUDIENCES, OFFERING_STATUSES, REQUEST_STATUSES } from '@/lib/domain';
import { toMinutes } from '@/lib/utils';
import { PointSchema, WindowSchema, defineModel } from './common';

const SpaceFacilitySchema = new Schema(
  {
    facilityTypeId: { type: Schema.Types.ObjectId, ref: 'FacilityType', required: true },
    quantity: { type: Number, min: 0, required: true },
    workingQuantity: { type: Number, min: 0, required: true },
  },
  { _id: false },
);

const SpaceSlotSchema = new Schema({
  dayOfWeek: { type: Number, min: 0, max: 6, required: true },
  startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  isBlocked: { type: Boolean, default: false },
});

const PolicySchema = new Schema(
  {
    /** Empty means every category is allowed. */
    allowedCategoryIds: { type: [Schema.Types.ObjectId], ref: 'CourseCategory', default: [] },
    /** Empty means every audience is allowed. */
    allowedAudiences: { type: [String], enum: AUDIENCES, default: [] },
    rentPerHour: { type: Number, min: 0, default: 0 },
    approvalMode: { type: String, enum: APPROVAL_MODES, default: 'auto' },
    rules: { type: String, default: '' },
  },
  { _id: false },
);

const SpaceSchema = new Schema(
  {
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    address: { type: String, default: '' },
    location: { type: PointSchema, required: true },
    areaId: { type: Schema.Types.ObjectId, ref: 'Area', required: true, index: true },
    isActive: { type: Boolean, default: true },
    seatCapacity: { type: Number, min: 1, required: true },
    photos: { type: [{ url: String, publicId: String }], default: [] },
    facilities: { type: [SpaceFacilitySchema], default: [] },
    slots: { type: [SpaceSlotSchema], default: [] },
    policy: { type: PolicySchema, default: () => ({}) },
  },
  { timestamps: true },
);
SpaceSchema.index({ location: '2dsphere' });
SpaceSchema.index({ 'slots.dayOfWeek': 1, _id: 1 });

SpaceSchema.pre('validate', function () {
  for (const f of this.facilities) {
    if (f.workingQuantity > f.quantity) {
      this.invalidate('facilities', 'workingQuantity cannot exceed quantity');
    }
  }
  const slots = [...this.slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime));
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    if (toMinutes(s.endTime) <= toMinutes(s.startTime)) this.invalidate('slots', 'slot end must be after start');
    const next = slots[i + 1];
    if (next && next.dayOfWeek === s.dayOfWeek && toMinutes(next.startTime) < toMinutes(s.endTime)) {
      this.invalidate('slots', 'slots on the same day cannot overlap');
    }
  }
});
export const Space = defineModel('Space', SpaceSchema);

const RequirementSchema = new Schema(
  {
    facilityTypeId: { type: Schema.Types.ObjectId, ref: 'FacilityType', required: true },
    minQuantity: { type: Number, min: 1, required: true },
  },
  { _id: false },
);

const CourseSchema = new Schema(
  {
    providerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CourseCategory', required: true },
    requirements: { type: [RequirementSchema], default: [] },
    coverUrl: { type: String, default: '' },
  },
  { timestamps: true },
);
export const Course = defineModel('Course', CourseSchema);

const OfferingSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    providerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Denormalised from the course for engine snapshots and listings.
    title: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CourseCategory', required: true },
    audience: { type: String, enum: AUDIENCES, default: 'Adults' },
    batchSize: { type: Number, min: 1, required: true },
    /** Length of the one weekly session. */
    sessionMinutes: { type: Number, min: 30, max: 480, required: true },
    durationWeeks: { type: Number, min: 1, max: 104, required: true },
    startDate: { type: Date, required: true },
    targetAreaId: { type: Schema.Types.ObjectId, ref: 'Area', default: null },
    status: { type: String, enum: OFFERING_STATUSES, default: 'Open', index: true },
    windows: { type: [WindowSchema], default: [] },
    /** The most rent per hour the provider will pay for a space. Null = no limit. */
    maxRentPerHour: { type: Number, min: 0, default: null },
    /** What a learner pays per month. Null or 0 = free. */
    feePerMonth: { type: Number, min: 0, default: null },
  },
  { timestamps: true },
);
OfferingSchema.index({ status: 1, categoryId: 1 });
export const CourseOffering = defineModel('CourseOffering', OfferingSchema);

const SuggestionSchema = new Schema(
  {
    offeringId: { type: Schema.Types.ObjectId, ref: 'CourseOffering', default: null },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CourseCategory', required: true },
    areaId: { type: Schema.Types.ObjectId, ref: 'Area', default: null },
    score: { type: Number, required: true },
    reasons: { type: [String], default: [] },
  },
  { _id: false },
);

const LearningRequestSchema = new Schema(
  {
    learnerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    learnerProfileId: { type: Schema.Types.ObjectId, ref: 'LearnerProfile', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CourseCategory', required: true },
    areaId: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    /** Exact point. Private: only the learner and administrators ever see it. */
    location: { type: PointSchema, required: true },
    audience: { type: String, enum: AUDIENCES, required: true },
    maxDistanceKm: { type: Number, min: 0.5, max: 50, required: true },
    startMonth: { type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/, required: true },
    durationMonths: { type: Number, min: 1, max: 24, required: true },
    consentShared: { type: Boolean, required: true },
    consentAt: { type: Date, required: true },
    status: { type: String, enum: REQUEST_STATUSES, default: 'Submitted' },
    /** Empty = flexible to the tutor's timing. */
    windows: { type: [WindowSchema], default: [] },
    requiredFacilityTypeIds: { type: [Schema.Types.ObjectId], ref: 'FacilityType', default: [] },
    budgetPerMonth: { type: Number, min: 0, default: null },
    notes: { type: String, default: '' },
    suggestions: { type: [SuggestionSchema], default: [] },
    lastRunId: { type: Schema.Types.ObjectId, ref: 'AllocationRun', default: null },
  },
  { timestamps: true },
);
LearningRequestSchema.index({ location: '2dsphere' });
LearningRequestSchema.index({ status: 1, categoryId: 1, areaId: 1 });
export const LearningRequest = defineModel('LearningRequest', LearningRequestSchema);
