import type { ApprovalMode, Audience, Role } from '@/lib/domain';
import { idStr, isoOrNull, lngLat, type IdLike } from './lookup';

export interface SpaceRecord {
  _id: IdLike;
  ownerUserId: IdLike;
  partnerId?: IdLike | null;
  name: string;
  description?: string | null;
  address?: string | null;
  location: { coordinates?: number[] | null };
  areaId: IdLike;
  isActive?: boolean | null;
  seatCapacity: number;
  photos?: { url?: string | null; publicId?: string | null }[] | null;
  facilities?: { facilityTypeId: IdLike; quantity: number; workingQuantity: number }[] | null;
  slots?: { _id?: IdLike; dayOfWeek: number; startTime: string; endTime: string; isBlocked?: boolean | null }[] | null;
  policy?: {
    allowedCategoryIds?: IdLike[] | null;
    allowedAudiences?: string[] | null;
    rentPerHour?: number | null;
    approvalMode?: string | null;
    rules?: string | null;
  } | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface SpaceSlotDto {
  id: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isBlocked: boolean;
}

/** What every signed-in user may see about a space (discovery, maps, allocations). */
export interface SpacePublicDto {
  visibility: 'public';
  canEdit: false;
  id: string;
  partnerId: string | null;
  name: string;
  description: string;
  address: string;
  /** Venue location [lng, lat]. Spaces are public places, so the exact point is shown. */
  location: [number, number];
  areaId: string;
  areaName: string | null;
  isActive: boolean;
  seatCapacity: number;
  photos: { url: string; publicId: string }[];
  facilities: { facilityTypeId: string; quantity: number; workingQuantity: number }[];
  slots: SpaceSlotDto[];
  policy: { allowedCategoryIds: string[]; allowedAudiences: Audience[] };
  createdAt: string | null;
  updatedAt: string | null;
}

/** Owner and administrator view: adds the owner, rent, approval mode and house rules. */
export interface SpaceFullDto extends Omit<SpacePublicDto, 'visibility' | 'canEdit' | 'policy'> {
  visibility: 'full';
  canEdit: true;
  ownerUserId: string;
  policy: {
    allowedCategoryIds: string[];
    allowedAudiences: Audience[];
    rentPerHour: number;
    approvalMode: ApprovalMode;
    rules: string;
  };
}

export type SpaceDto = SpacePublicDto | SpaceFullDto;

export function canEditSpace(viewer: { id: string; role: Role }, s: Pick<SpaceRecord, 'ownerUserId'>): boolean {
  return viewer.role === 'Administrator' || String(s.ownerUserId) === viewer.id;
}

/** Maps a space for a viewer: full for the owner and administrators, public fields for everyone else. */
export function spaceDto(s: SpaceRecord, viewer: { id: string; role: Role }, extra: { areaName?: string | null } = {}): SpaceDto {
  const policy = s.policy ?? {};
  const base = {
    id: String(s._id),
    partnerId: idStr(s.partnerId),
    name: s.name,
    description: s.description ?? '',
    address: s.address ?? '',
    location: lngLat(s.location),
    areaId: String(s.areaId),
    areaName: extra.areaName ?? null,
    isActive: s.isActive ?? true,
    seatCapacity: s.seatCapacity,
    photos: (s.photos ?? []).map((p) => ({ url: p.url ?? '', publicId: p.publicId ?? '' })),
    facilities: (s.facilities ?? []).map((f) => ({
      facilityTypeId: String(f.facilityTypeId),
      quantity: f.quantity,
      workingQuantity: f.workingQuantity,
    })),
    slots: (s.slots ?? []).map((sl) => ({
      id: idStr(sl._id),
      dayOfWeek: sl.dayOfWeek,
      startTime: sl.startTime,
      endTime: sl.endTime,
      isBlocked: sl.isBlocked ?? false,
    })),
    createdAt: isoOrNull(s.createdAt),
    updatedAt: isoOrNull(s.updatedAt),
  };
  const allowedCategoryIds = (policy.allowedCategoryIds ?? []).map(String);
  const allowedAudiences = (policy.allowedAudiences ?? []) as Audience[];
  if (canEditSpace(viewer, s)) {
    return {
      ...base,
      visibility: 'full',
      canEdit: true,
      ownerUserId: String(s.ownerUserId),
      policy: {
        allowedCategoryIds,
        allowedAudiences,
        rentPerHour: policy.rentPerHour ?? 0,
        approvalMode: (policy.approvalMode ?? 'auto') as ApprovalMode,
        rules: policy.rules ?? '',
      },
    };
  }
  return { ...base, visibility: 'public', canEdit: false, policy: { allowedCategoryIds, allowedAudiences } };
}
