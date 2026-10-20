import type { PartnerType, Role, UserStatus } from '@/lib/domain';
import { idStr, isoOrNull, type IdLike } from './lookup';

/** Never includes passwordHash: the mapper copies named fields only. */
export interface UserRecord {
  _id: IdLike;
  email: string;
  name: string;
  role: string;
  status?: string | null;
  ownerRefId?: IdLike | null;
  emailNotifications?: boolean | null;
  lastLoginAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  ownerRefId: string | null;
  emailNotifications: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}
export function userDto(u: UserRecord): UserDto {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    role: u.role as Role,
    status: (u.status ?? 'Active') as UserStatus,
    ownerRefId: idStr(u.ownerRefId),
    emailNotifications: u.emailNotifications ?? false,
    lastLoginAt: isoOrNull(u.lastLoginAt),
    createdAt: isoOrNull(u.createdAt),
  };
}

export interface LearnerProfileRecord {
  _id: IdLike;
  userId: IdLike;
  name: string;
  ageBand: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  areaId?: IdLike | null;
  accessibilityNeeds?: string[] | null;
  consentAt?: Date | null;
}
export interface LearnerProfileDto {
  id: string;
  userId: string;
  name: string;
  ageBand: string;
  contactPhone: string;
  contactEmail: string;
  areaId: string | null;
  accessibilityNeeds: string[];
  consentAt: string | null;
}
export function learnerProfileDto(p: LearnerProfileRecord): LearnerProfileDto {
  return {
    id: String(p._id),
    userId: String(p.userId),
    name: p.name,
    ageBand: p.ageBand,
    contactPhone: p.contactPhone ?? '',
    contactEmail: p.contactEmail ?? '',
    areaId: idStr(p.areaId),
    accessibilityNeeds: p.accessibilityNeeds ?? [],
    consentAt: isoOrNull(p.consentAt),
  };
}

export interface PartnerRecord {
  _id: IdLike;
  userId: IdLike;
  type: string;
  name: string;
  logoUrl?: string | null;
  contactPhone?: string | null;
  about?: string | null;
}
export interface PartnerDto {
  id: string;
  userId: string;
  type: PartnerType;
  name: string;
  logoUrl: string;
  contactPhone: string;
  about: string;
}
export function partnerDto(p: PartnerRecord): PartnerDto {
  return {
    id: String(p._id),
    userId: String(p.userId),
    type: p.type as PartnerType,
    name: p.name,
    logoUrl: p.logoUrl ?? '',
    contactPhone: p.contactPhone ?? '',
    about: p.about ?? '',
  };
}

/** `{ user, profile }` for learners, `{ user, partner }` for partners, `{ user }` for administrators. */
export interface AccountDto {
  user: UserDto;
  profile?: LearnerProfileDto;
  partner?: PartnerDto;
}
