import bcrypt from 'bcryptjs';
import type { Model, Types } from 'mongoose';
import { DEFAULT_TEMPLATES } from '@/server/notifications/defaults';
import { DEFAULT_SETTINGS, SETTING_DESCRIPTIONS, type SettingKey } from '@/server/services/settings';
import { Area, CourseCategory, FacilityType, NotificationTemplate, StudentDemand, SystemSetting, User } from '@/server/models';
import { AREAS } from './data/areas';
import { CATEGORY_TREE, PARENT_CATEGORIES } from './data/categories';
import { STUDENT_DEMAND } from './data/demand';
import { FACILITY_TYPES } from './data/facilities';
import { SEED_BCRYPT_COST } from './constants';

/**
 * Base data every profile needs. Each step only inserts what is missing, so admin edits
 * (renamed templates, tuned settings, edited demographics) survive a re-seed.
 * Inserts go through the models so every validator runs.
 */

export interface LookupIds {
  facilities: Map<string, Types.ObjectId>;
  categories: Map<string, Types.ObjectId>;
  areas: Map<string, Types.ObjectId>;
}

export interface BaseResult {
  inserted: Record<'facilityTypes' | 'courseCategories' | 'areas' | 'studentDemand' | 'settings' | 'templates', number>;
  ids: LookupIds;
}

/** Inserts the docs whose key is not in the collection yet. Returns how many were inserted. */
async function insertMissing<T extends Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>,
  docs: T[],
  key: (doc: Record<string, unknown>) => string,
  projection: string,
): Promise<number> {
  const existing = new Set((await model.find({}, projection).lean<Record<string, unknown>[]>()).map(key));
  const missing = docs.filter((d) => !existing.has(key(d)));
  if (missing.length > 0) await model.insertMany(missing);
  return missing.length;
}

async function idMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>,
): Promise<Map<string, Types.ObjectId>> {
  const docs = await model.find({}, 'name').lean<{ _id: Types.ObjectId; name: string }[]>();
  return new Map(docs.map((d) => [d.name, d._id]));
}

export async function seedBase(): Promise<BaseResult> {
  const byName = (d: Record<string, unknown>) => String(d.name);
  const facilityTypes = await insertMissing(FacilityType, FACILITY_TYPES.map((f) => ({ ...f })), byName, 'name');

  let courseCategories = await insertMissing(CourseCategory, PARENT_CATEGORIES.map((name) => ({ name, parentId: null })), byName, 'name');
  const parents = await idMap(CourseCategory);
  const children = PARENT_CATEGORIES.flatMap((p) => CATEGORY_TREE[p].map((name) => ({ name, parentId: parents.get(p)! })));
  courseCategories += await insertMissing(CourseCategory, children, byName, 'name');

  const areas = await insertMissing(
    Area,
    AREAS.map((a) => ({
      name: a.name,
      city: a.city,
      center: { type: 'Point', coordinates: a.center },
      population: a.population,
      studentCount: a.studentCount,
      literacyRate: a.literacyRate,
      incomeScore: a.incomeScore,
      incomeGroup: a.incomeGroup,
    })),
    byName,
    'name',
  );

  const ids: LookupIds = { facilities: await idMap(FacilityType), categories: await idMap(CourseCategory), areas: await idMap(Area) };

  const pairKey = (d: Record<string, unknown>) => `${String(d.areaId)}:${String(d.categoryId)}`;
  const studentDemand = await insertMissing(
    StudentDemand,
    STUDENT_DEMAND.flatMap((d) => {
      const areaId = ids.areas.get(d.areaName);
      const categoryId = ids.categories.get(d.category);
      // An admin may have renamed or deleted an area or category: skip rather than recreate it.
      return areaId && categoryId ? [{ areaId, categoryId, baseline: d.baseline }] : [];
    }),
    pairKey,
    'areaId categoryId',
  );

  const settings = await insertMissing(
    SystemSetting,
    (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).map((key) => ({ key, value: DEFAULT_SETTINGS[key], description: SETTING_DESCRIPTIONS[key] })),
    (d) => String(d.key),
    'key',
  );

  const templates = await insertMissing(
    NotificationTemplate,
    DEFAULT_TEMPLATES.map((t) => ({ ...t, sendEmail: t.sendEmail ?? false })),
    (d) => `${String(d.type)}:${String(d.role)}`,
    'type role',
  );

  return { inserted: { facilityTypes, courseCategories, areas, studentDemand, settings, templates }, ids };
}

export type AdminOutcome = { status: 'created' | 'exists'; email: string } | { status: 'skipped'; reason: string };

/**
 * PLAN 1.4: the first Administrator from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD. Upsert by email:
 * running twice never duplicates the admin, and an existing account's password is never overwritten.
 */
export async function seedAdmin(email: string | undefined, password: string | undefined): Promise<AdminOutcome> {
  if (!email || !password) {
    return { status: 'skipped', reason: 'ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are not both set' };
  }
  const normalised = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalised }, 'role').lean();
  if (existing) {
    if (existing.role !== 'Administrator') {
      return { status: 'skipped', reason: `${normalised} already exists with role ${existing.role}; not changed` };
    }
    return { status: 'exists', email: normalised };
  }
  await User.create({
    email: normalised,
    name: 'Administrator',
    role: 'Administrator',
    passwordHash: await bcrypt.hash(password, SEED_BCRYPT_COST),
    status: 'Active',
  });
  return { status: 'created', email: normalised };
}
