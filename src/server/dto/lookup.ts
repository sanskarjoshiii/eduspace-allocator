import type { Types } from 'mongoose';
import type { DemandLevel, IncomeGroup } from '@/lib/domain';

export type IdLike = Types.ObjectId | string;

/** Id (or null) as a string, for DTOs. */
export function idStr(v: IdLike | null | undefined): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** [lng, lat] from a stored GeoJSON point. */
export function lngLat(p: { coordinates?: number[] | null } | null | undefined): [number, number] {
  const c = p?.coordinates ?? [];
  return [Number(c[0] ?? 0), Number(c[1] ?? 0)];
}

export const isoOrNull = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

// ---- Facility types ----

export interface FacilityTypeRecord {
  _id: IdLike;
  name: string;
  unit?: string | null;
  description?: string | null;
}
export interface FacilityTypeDto {
  id: string;
  name: string;
  unit: string;
  description: string;
}
export function facilityTypeDto(d: FacilityTypeRecord): FacilityTypeDto {
  return { id: String(d._id), name: d.name, unit: d.unit ?? 'units', description: d.description ?? '' };
}

// ---- Course categories ----

export interface CategoryRecord {
  _id: IdLike;
  name: string;
  parentId?: IdLike | null;
}
export interface CategoryDto {
  id: string;
  name: string;
  parentId: string | null;
}
export function categoryDto(d: CategoryRecord): CategoryDto {
  return { id: String(d._id), name: d.name, parentId: idStr(d.parentId) };
}

// ---- Areas ----

export interface AreaRecord {
  _id: IdLike;
  name: string;
  city?: string | null;
  center: { coordinates?: number[] | null };
  population: number;
  studentCount: number;
  literacyRate: number;
  incomeScore: number;
  incomeGroup: string;
  demandLevel?: string | null;
  clusterId?: number | null;
  demandIndex?: number | null;
  /** Present on `near` queries. */
  distanceKm?: number;
}
export interface AreaDto {
  id: string;
  name: string;
  city: string;
  /** [lng, lat] */
  center: [number, number];
  population: number;
  studentCount: number;
  literacyRate: number;
  incomeScore: number;
  incomeGroup: IncomeGroup;
  demandLevel: DemandLevel | null;
  clusterId: number | null;
  demandIndex: number | null;
  distanceKm?: number;
}
export function areaDto(d: AreaRecord): AreaDto {
  const out: AreaDto = {
    id: String(d._id),
    name: d.name,
    city: d.city ?? '',
    center: lngLat(d.center),
    population: d.population,
    studentCount: d.studentCount,
    literacyRate: d.literacyRate,
    incomeScore: d.incomeScore,
    incomeGroup: d.incomeGroup as IncomeGroup,
    demandLevel: (d.demandLevel ?? null) as DemandLevel | null,
    clusterId: d.clusterId ?? null,
    demandIndex: d.demandIndex ?? null,
  };
  if (typeof d.distanceKm === 'number') out.distanceKm = Math.round(d.distanceKm * 100) / 100;
  return out;
}
