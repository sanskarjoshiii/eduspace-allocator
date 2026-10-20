import type { Audience, OfferingStatus, Role } from '@/lib/domain';
import { idStr, isoOrNull, type IdLike } from './lookup';

export interface OfferingRecord {
  _id: IdLike;
  courseId: IdLike;
  providerUserId: IdLike;
  title: string;
  categoryId: IdLike;
  audience?: string | null;
  batchSize: number;
  sessionMinutes: number;
  durationWeeks: number;
  startDate: Date | string;
  targetAreaId?: IdLike | null;
  status?: string | null;
  windows?: { dayOfWeek: number; startTime: string; endTime: string }[] | null;
  maxRentPerHour?: number | null;
  feePerMonth?: number | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface OfferingDto {
  id: string;
  courseId: string;
  providerUserId: string;
  providerName: string | null;
  title: string;
  categoryId: string;
  categoryName: string | null;
  audience: Audience;
  batchSize: number;
  sessionMinutes: number;
  durationWeeks: number;
  startDate: string;
  targetAreaId: string | null;
  targetAreaName: string | null;
  status: OfferingStatus;
  windows: { dayOfWeek: number; startTime: string; endTime: string }[];
  feePerMonth: number | null;
  /** Owner and administrators only (the provider's rent budget). */
  maxRentPerHour?: number | null;
  canEdit: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export function offeringDto(
  o: OfferingRecord,
  viewer: { id: string; role: Role },
  extra: { categoryName?: string | null; targetAreaName?: string | null; providerName?: string | null } = {},
): OfferingDto {
  const canEdit = viewer.role === 'Administrator' || String(o.providerUserId) === viewer.id;
  const dto: OfferingDto = {
    id: String(o._id),
    courseId: String(o.courseId),
    providerUserId: String(o.providerUserId),
    providerName: extra.providerName ?? null,
    title: o.title,
    categoryId: String(o.categoryId),
    categoryName: extra.categoryName ?? null,
    audience: (o.audience ?? 'Adults') as Audience,
    batchSize: o.batchSize,
    sessionMinutes: o.sessionMinutes,
    durationWeeks: o.durationWeeks,
    startDate: new Date(o.startDate).toISOString(),
    targetAreaId: idStr(o.targetAreaId),
    targetAreaName: extra.targetAreaName ?? null,
    status: (o.status ?? 'Open') as OfferingStatus,
    windows: (o.windows ?? []).map((w) => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
    feePerMonth: o.feePerMonth ?? null,
    canEdit,
    createdAt: isoOrNull(o.createdAt),
    updatedAt: isoOrNull(o.updatedAt),
  };
  if (canEdit) dto.maxRentPerHour = o.maxRentPerHour ?? null;
  return dto;
}
