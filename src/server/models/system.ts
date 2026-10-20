import { Schema } from 'mongoose';
import { DOMAIN_EVENT_TYPES, NOTIFICATION_TYPES, ROLES } from '@/lib/domain';
import { defineModel } from './common';

const NotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    relatedType: { type: String, default: null },
    relatedId: { type: Schema.Types.ObjectId, default: null },
    /** In-app link the bell opens. */
    href: { type: String, default: null },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    emailedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
export const Notification = defineModel('Notification', NotificationSchema);

const NotificationTemplateSchema = new Schema(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    role: { type: String, enum: ROLES, required: true },
    /** Mustache-style placeholders: {{courseTitle}}. */
    titleTemplate: { type: String, required: true },
    bodyTemplate: { type: String, required: true },
    sendEmail: { type: Boolean, default: false },
  },
  { timestamps: true },
);
NotificationTemplateSchema.index({ type: 1, role: 1 }, { unique: true });
export const NotificationTemplate = defineModel('NotificationTemplate', NotificationTemplateSchema);

const SystemSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    description: { type: String, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
export const SystemSetting = defineModel('SystemSetting', SystemSettingSchema);

const DomainEventSchema = new Schema(
  {
    type: { type: String, enum: DOMAIN_EVENT_TYPES, required: true },
    refId: { type: Schema.Types.ObjectId, default: null },
    payload: { type: Schema.Types.Mixed, default: null },
    processedAt: { type: Date, default: null },
    runId: { type: Schema.Types.ObjectId, ref: 'AllocationRun', default: null },
  },
  { timestamps: true },
);
DomainEventSchema.index({ processedAt: 1, createdAt: 1 });
export const DomainEvent = defineModel('DomainEvent', DomainEventSchema);

const AuditLogSchema = new Schema(
  {
    /** Null for system actors (worker, cron). */
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorRole: { type: String, default: 'System' },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, default: null },
    /** Owner of the affected record, so non-admins can read "own activity". */
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    diff: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
AuditLogSchema.index({ entity: 1, createdAt: -1 });
export const AuditLog = defineModel('AuditLog', AuditLogSchema);

/** Single-document lock: one allocation run at a time, released by expiry if a run dies. */
const RunLockSchema = new Schema({
  _id: { type: String, required: true },
  holder: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});
export const RunLock = defineModel('RunLock', RunLockSchema);

/** Dedupes the multi-area demand alert until demand changes. */
const AlertStateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    signature: { type: String, required: true },
    lastFiredAt: { type: Date, required: true },
  },
  { timestamps: true },
);
export const AlertState = defineModel('AlertState', AlertStateSchema);
