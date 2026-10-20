import type { Role } from '@/lib/domain';
import { idStr, isoOrNull, type IdLike } from './lookup';

export interface CourseRecord {
  _id: IdLike;
  providerUserId: IdLike;
  partnerId?: IdLike | null;
  title: string;
  description?: string | null;
  categoryId: IdLike;
  requirements?: { facilityTypeId: IdLike; minQuantity: number }[] | null;
  coverUrl?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface CourseDto {
  id: string;
  providerUserId: string;
  partnerId: string | null;
  providerName: string | null;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string | null;
  requirements: { facilityTypeId: string; minQuantity: number }[];
  coverUrl: string;
  canEdit: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export function courseDto(
  c: CourseRecord,
  viewer: { id: string; role: Role },
  extra: { categoryName?: string | null; providerName?: string | null } = {},
): CourseDto {
  return {
    id: String(c._id),
    providerUserId: String(c.providerUserId),
    partnerId: idStr(c.partnerId),
    providerName: extra.providerName ?? null,
    title: c.title,
    description: c.description ?? '',
    categoryId: String(c.categoryId),
    categoryName: extra.categoryName ?? null,
    requirements: (c.requirements ?? []).map((r) => ({ facilityTypeId: String(r.facilityTypeId), minQuantity: r.minQuantity })),
    coverUrl: c.coverUrl ?? '',
    canEdit: viewer.role === 'Administrator' || String(c.providerUserId) === viewer.id,
    createdAt: isoOrNull(c.createdAt),
    updatedAt: isoOrNull(c.updatedAt),
  };
}
