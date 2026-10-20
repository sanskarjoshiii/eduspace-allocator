import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { AGE_BANDS, PARTNER_TYPES, ROLES, USER_STATUSES } from '@/lib/domain';
import { defineModel } from './common';

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    /** LearnerProfile id for learners, Partner id for space givers and providers, null for administrators. */
    ownerRefId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: USER_STATUSES, default: 'Active' },
    emailNotifications: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);
export type UserDoc = HydratedDocument<InferSchemaType<typeof UserSchema>>;
export const User = defineModel('User', UserSchema);

const LearnerProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, required: true, trim: true },
    ageBand: { type: String, enum: AGE_BANDS, required: true },
    contactPhone: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
    areaId: { type: Schema.Types.ObjectId, ref: 'Area', default: null },
    accessibilityNeeds: { type: [String], default: [] },
    consentAt: { type: Date, default: null },
  },
  { timestamps: true },
);
export const LearnerProfile = defineModel('LearnerProfile', LearnerProfileSchema);

const PartnerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    type: { type: String, enum: PARTNER_TYPES, required: true },
    name: { type: String, required: true, trim: true },
    logoUrl: { type: String, default: '' },
    contactPhone: { type: String, default: '' },
    about: { type: String, default: '' },
  },
  { timestamps: true },
);
export const Partner = defineModel('Partner', PartnerSchema);
