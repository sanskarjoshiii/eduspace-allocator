import { Types } from 'mongoose';
import {
  Area,
  Course,
  CourseCategory,
  CourseOffering,
  DemandInsight,
  FacilityIssue,
  FacilityType,
  LearnerProfile,
  LearningRequest,
  Space,
  StudentDemand,
} from '@/server/models';
import { conflict, notFound, type SessionUser } from '@/server/http';
import { audit, diffOf } from '@/server/services/audit';
import {
  areaDto,
  categoryDto,
  facilityTypeDto,
  type AreaDto,
  type AreaRecord,
  type CategoryDto,
  type CategoryRecord,
  type FacilityTypeDto,
  type FacilityTypeRecord,
} from '@/server/dto/lookup';
import type { AreaInput, AreaUpdate, CategoryInput, CategoryUpdate, FacilityTypeInput, FacilityTypeUpdate } from '@/schemas/lookups';
import { nearestAreas, unprocessable } from './areas';

/** Escapes user text for use inside a RegExp. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const oid = (id: string) => new Types.ObjectId(id);

/** Throws 422 on `field` unless every id is an existing facility type. */
export async function requireFacilityTypes(ids: string[], field: string): Promise<void> {
  const unique = [...new Set(ids.map((i) => i.toLowerCase()))];
  if (unique.length === 0) return;
  const n = await FacilityType.countDocuments({ _id: { $in: unique.map(oid) } });
  if (n !== unique.length) throw unprocessable('Choose valid facility types', field);
}

/** Throws 422 on `field` unless every id is an existing category. */
export async function requireCategories(ids: string[], field: string): Promise<void> {
  const unique = [...new Set(ids.map((i) => i.toLowerCase()))];
  if (unique.length === 0) return;
  const n = await CourseCategory.countDocuments({ _id: { $in: unique.map(oid) } });
  if (n !== unique.length) throw unprocessable('Choose valid categories', field);
}

/** Loads one category or throws 422 on `field`. */
export async function requireCategory(id: string, field = 'categoryId'): Promise<CategoryRecord> {
  const c = await CourseCategory.findById(id).lean<CategoryRecord>();
  if (!c) throw unprocessable('Choose a valid category', field);
  return c;
}

/** id → name maps for a set of ids, for DTO enrichment. */
export async function namesById(model: 'area' | 'category', ids: (string | Types.ObjectId | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string | Types.ObjectId => Boolean(i)).map(String))];
  if (unique.length === 0) return new Map();
  const M = model === 'area' ? Area : CourseCategory;
  const rows = await (M as typeof CourseCategory).find({ _id: { $in: unique.map(oid) } }).select('name').lean<{ _id: Types.ObjectId; name: string }[]>();
  return new Map(rows.map((r) => [String(r._id), r.name]));
}

async function assertNoReferences(checks: [string, Promise<unknown>][]): Promise<void> {
  const results = await Promise.all(checks.map(([, p]) => p));
  const used = checks.filter((_, i) => results[i]).map(([what]) => what);
  if (used.length > 0) throw conflict(`This is still used by ${used.join(', ')}. Remove those references first.`, { usedBy: used });
}

// ---- Facility types ----

export async function listFacilityTypes(): Promise<FacilityTypeDto[]> {
  const rows = await FacilityType.find().sort({ name: 1 }).lean<FacilityTypeRecord[]>();
  return rows.map(facilityTypeDto);
}

export async function createFacilityType(actor: SessionUser, input: FacilityTypeInput): Promise<FacilityTypeDto> {
  const doc = await FacilityType.create(input);
  await audit({ actor, action: 'create', entity: 'FacilityType', entityId: doc._id, diff: input });
  return facilityTypeDto(doc.toObject() as FacilityTypeRecord);
}

export async function updateFacilityType(actor: SessionUser, id: string, input: FacilityTypeUpdate): Promise<FacilityTypeDto> {
  const doc = await FacilityType.findById(id);
  if (!doc) throw notFound('Facility type');
  const before = facilityTypeDto(doc.toObject() as FacilityTypeRecord);
  doc.set(input);
  await doc.save();
  const after = facilityTypeDto(doc.toObject() as FacilityTypeRecord);
  await audit({ actor, action: 'update', entity: 'FacilityType', entityId: doc._id, diff: diffOf({ ...before }, { ...after }) });
  return after;
}

export async function deleteFacilityType(actor: SessionUser, id: string): Promise<void> {
  const doc = await FacilityType.findById(id).lean<FacilityTypeRecord>();
  if (!doc) throw notFound('Facility type');
  const _id = oid(id);
  await assertNoReferences([
    ['spaces', Space.exists({ 'facilities.facilityTypeId': _id })],
    ['courses', Course.exists({ 'requirements.facilityTypeId': _id })],
    ['learning requests', LearningRequest.exists({ requiredFacilityTypeIds: _id })],
    ['facility issues', FacilityIssue.exists({ facilityTypeId: _id })],
  ]);
  await FacilityType.deleteOne({ _id });
  await audit({ actor, action: 'delete', entity: 'FacilityType', entityId: _id, diff: facilityTypeDto(doc) });
}

// ---- Course categories ----

export async function listCategories(filter: { parentId?: string } = {}): Promise<CategoryDto[]> {
  const q: Record<string, unknown> = {};
  if (filter.parentId === 'null') q.parentId = null;
  else if (filter.parentId) q.parentId = oid(filter.parentId);
  const rows = await CourseCategory.find(q).sort({ name: 1 }).lean<CategoryRecord[]>();
  return rows.map(categoryDto);
}

async function checkParent(parentId: string | null | undefined, selfId?: string): Promise<void> {
  if (!parentId) return;
  if (selfId && parentId === selfId) throw unprocessable('A category cannot be its own parent', 'parentId');
  const parent = await CourseCategory.findById(parentId).lean<CategoryRecord>();
  if (!parent) throw unprocessable('Choose a valid parent category', 'parentId');
  // Walk up to prevent cycles.
  let cursor: CategoryRecord | null = parent;
  for (let depth = 0; cursor?.parentId && depth < 20; depth++) {
    if (selfId && String(cursor.parentId) === selfId) throw unprocessable('This would create a loop of parent categories', 'parentId');
    cursor = await CourseCategory.findById(cursor.parentId).lean<CategoryRecord>();
  }
}

export async function createCategory(actor: SessionUser, input: CategoryInput): Promise<CategoryDto> {
  await checkParent(input.parentId);
  const doc = await CourseCategory.create({ name: input.name, parentId: input.parentId ?? null });
  await audit({ actor, action: 'create', entity: 'CourseCategory', entityId: doc._id, diff: input });
  return categoryDto(doc.toObject() as CategoryRecord);
}

export async function updateCategory(actor: SessionUser, id: string, input: CategoryUpdate): Promise<CategoryDto> {
  const doc = await CourseCategory.findById(id);
  if (!doc) throw notFound('Category');
  if (input.parentId !== undefined) await checkParent(input.parentId, id);
  const before = categoryDto(doc.toObject() as CategoryRecord);
  if (input.name !== undefined) doc.name = input.name;
  if (input.parentId !== undefined) doc.set('parentId', input.parentId ? oid(input.parentId) : null);
  await doc.save();
  const after = categoryDto(doc.toObject() as CategoryRecord);
  await audit({ actor, action: 'update', entity: 'CourseCategory', entityId: doc._id, diff: diffOf({ ...before }, { ...after }) });
  return after;
}

export async function deleteCategory(actor: SessionUser, id: string): Promise<void> {
  const doc = await CourseCategory.findById(id).lean<CategoryRecord>();
  if (!doc) throw notFound('Category');
  const _id = oid(id);
  await assertNoReferences([
    ['child categories', CourseCategory.exists({ parentId: _id })],
    ['courses', Course.exists({ categoryId: _id })],
    ['offerings', CourseOffering.exists({ categoryId: _id })],
    ['learning requests', LearningRequest.exists({ categoryId: _id })],
    ['space policies', Space.exists({ 'policy.allowedCategoryIds': _id })],
    ['student demand baselines', StudentDemand.exists({ categoryId: _id })],
    ['demand insights', DemandInsight.exists({ categoryId: _id })],
  ]);
  await CourseCategory.deleteOne({ _id });
  await audit({ actor, action: 'delete', entity: 'CourseCategory', entityId: _id, diff: categoryDto(doc) });
}

// ---- Areas ----

export async function listAreas(query: { near?: [number, number]; q?: string; limit?: number }): Promise<AreaDto[]> {
  const match: Record<string, unknown> = {};
  if (query.q) match.name = { $regex: escapeRegex(query.q), $options: 'i' };
  if (query.near) {
    const rows = await nearestAreas(query.near, query.limit ?? 5, match);
    return rows.map(areaDto);
  }
  let find = Area.find(match).sort({ name: 1 });
  if (query.limit) find = find.limit(query.limit);
  const rows = await find.lean<AreaRecord[]>();
  return rows.map(areaDto);
}

export async function getArea(id: string): Promise<AreaDto> {
  const a = await Area.findById(id).lean<AreaRecord>();
  if (!a) throw notFound('Area');
  return areaDto(a);
}

export async function createArea(actor: SessionUser, input: AreaInput): Promise<AreaDto> {
  const doc = await Area.create(input);
  await audit({ actor, action: 'create', entity: 'Area', entityId: doc._id, diff: input });
  return areaDto(doc.toObject() as AreaRecord);
}

export async function updateArea(actor: SessionUser, id: string, input: AreaUpdate): Promise<AreaDto> {
  const doc = await Area.findById(id);
  if (!doc) throw notFound('Area');
  const before = areaDto(doc.toObject() as AreaRecord);
  doc.set(input);
  await doc.save();
  const after = areaDto(doc.toObject() as AreaRecord);
  await audit({ actor, action: 'update', entity: 'Area', entityId: doc._id, diff: diffOf({ ...before }, { ...after }) });
  return after;
}

export async function deleteArea(actor: SessionUser, id: string): Promise<void> {
  const doc = await Area.findById(id).lean<AreaRecord>();
  if (!doc) throw notFound('Area');
  const _id = oid(id);
  await assertNoReferences([
    ['spaces', Space.exists({ areaId: _id })],
    ['learning requests', LearningRequest.exists({ areaId: _id })],
    ['offerings', CourseOffering.exists({ targetAreaId: _id })],
    ['learner profiles', LearnerProfile.exists({ areaId: _id })],
    ['student demand baselines', StudentDemand.exists({ areaId: _id })],
    ['demand insights', DemandInsight.exists({ areaId: _id })],
  ]);
  await Area.deleteOne({ _id });
  await audit({ actor, action: 'delete', entity: 'Area', entityId: _id, diff: areaDto(doc) });
}

/** Everything a registry form needs in one call. */
export async function allLookups(): Promise<{ facilityTypes: FacilityTypeDto[]; categories: CategoryDto[]; areas: AreaDto[] }> {
  const [facilityTypes, categories, areas] = await Promise.all([listFacilityTypes(), listCategories(), listAreas({})]);
  return { facilityTypes, categories, areas };
}
