import { Types } from 'mongoose';
import { Course, CourseOffering, LearnerProfile, LearningRequest, Partner, Space, User } from '@/server/models';
import type { LookupIds } from './base';
import type { PlanAccount, SeedPlan } from './types';

/**
 * Writes a seed plan through the models (insertMany runs every schema validator and the
 * Space pre-validate hook). Ids are allocated up front so users point at their profile or
 * partner record without a second pass.
 */

const CHUNK = 1000;

async function insertChunked(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: { insertMany: (docs: any[]) => Promise<unknown> },
  docs: Record<string, unknown>[],
): Promise<number> {
  for (let i = 0; i < docs.length; i += CHUNK) await model.insertMany(docs.slice(i, i + CHUNK));
  return docs.length;
}

function lookup(map: Map<string, Types.ObjectId>, kind: string, name: string): Types.ObjectId {
  const id = map.get(name);
  if (!id) throw new Error(`Seed: ${kind} "${name}" is missing. Was it renamed or deleted? Run with --reset to rebuild lookups.`);
  return id;
}

export function planEmails(plan: SeedPlan): string[] {
  return [...plan.spaceGivers.map((g) => g.account), ...plan.providers.map((p) => p.account), ...plan.learners.map((l) => l.account)].map((a) => a.email);
}

export interface ApplyCounts {
  users: number;
  partners: number;
  learnerProfiles: number;
  spaces: number;
  courses: number;
  offerings: number;
  requests: number;
}

/**
 * Every seeded account shares one bcrypt hash of the demo password (hashing once keeps the
 * bench profile fast at full cost). `now` stamps consent times.
 */
export async function applyPlan(plan: SeedPlan, ids: LookupIds, passwordHash: string, now: Date): Promise<ApplyCounts> {
  const users: Record<string, unknown>[] = [];
  const partners: Record<string, unknown>[] = [];
  const profiles: Record<string, unknown>[] = [];
  const spaces: Record<string, unknown>[] = [];
  const courses: Record<string, unknown>[] = [];
  const offerings: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];

  const facility = (name: string) => lookup(ids.facilities, 'facility type', name);
  const category = (name: string) => lookup(ids.categories, 'course category', name);
  const area = (name: string) => lookup(ids.areas, 'area', name);
  const point = (coordinates: [number, number]) => ({ type: 'Point', coordinates });

  const addUser = (account: PlanAccount, ownerRefId: Types.ObjectId) => {
    const _id = new Types.ObjectId();
    users.push({ _id, email: account.email, name: account.name, role: account.role, passwordHash, ownerRefId, status: 'Active' });
    return _id;
  };

  for (const giver of plan.spaceGivers) {
    const partnerId = new Types.ObjectId();
    const userId = addUser(giver.account, partnerId);
    partners.push({ _id: partnerId, userId, ...giver.partner });
    for (const s of giver.spaces) {
      spaces.push({
        ownerUserId: userId,
        partnerId,
        name: s.name,
        description: s.description,
        address: s.address,
        location: point(s.location),
        areaId: area(s.areaName),
        isActive: true,
        seatCapacity: s.seatCapacity,
        facilities: s.facilities.map((f) => ({ facilityTypeId: facility(f.facility), quantity: f.quantity, workingQuantity: f.workingQuantity })),
        slots: s.slots.map((slot) => ({ ...slot })),
        policy: {
          allowedCategoryIds: s.policy.categories.map(category),
          allowedAudiences: s.policy.audiences,
          rentPerHour: s.policy.rentPerHour,
          approvalMode: s.policy.approvalMode,
          rules: s.policy.rules,
        },
      });
    }
  }

  for (const provider of plan.providers) {
    const partnerId = new Types.ObjectId();
    const userId = addUser(provider.account, partnerId);
    partners.push({ _id: partnerId, userId, ...provider.partner });
    for (const c of provider.courses) {
      const courseId = new Types.ObjectId();
      const categoryId = category(c.category);
      courses.push({
        _id: courseId,
        providerUserId: userId,
        partnerId,
        title: c.title,
        description: c.description,
        categoryId,
        requirements: c.requirements.map((r) => ({ facilityTypeId: facility(r.facility), minQuantity: r.minQuantity })),
      });
      for (const o of c.offerings) {
        offerings.push({
          courseId,
          providerUserId: userId,
          title: c.title,
          categoryId,
          audience: o.audience,
          batchSize: o.batchSize,
          sessionMinutes: o.sessionMinutes,
          durationWeeks: o.durationWeeks,
          startDate: o.startDate,
          targetAreaId: o.targetAreaName ? area(o.targetAreaName) : null,
          status: 'Open',
          windows: o.windows.map((w) => ({ ...w })),
          maxRentPerHour: o.maxRentPerHour,
          feePerMonth: o.feePerMonth,
        });
      }
    }
  }

  for (const learner of plan.learners) {
    const profileId = new Types.ObjectId();
    const userId = addUser(learner.account, profileId);
    profiles.push({
      _id: profileId,
      userId,
      name: learner.account.name,
      ageBand: learner.ageBand,
      contactPhone: learner.contactPhone,
      contactEmail: learner.account.email,
      areaId: area(learner.areaName),
      accessibilityNeeds: learner.accessibilityNeeds,
      consentAt: now,
    });
    for (const r of learner.requests) {
      requests.push({
        learnerUserId: userId,
        learnerProfileId: profileId,
        categoryId: category(r.category),
        areaId: area(r.areaName),
        location: point(r.location),
        audience: r.audience,
        maxDistanceKm: r.maxDistanceKm,
        startMonth: r.startMonth,
        durationMonths: r.durationMonths,
        consentShared: true,
        consentAt: now,
        status: 'Submitted',
        windows: r.windows.map((w) => ({ ...w })),
        requiredFacilityTypeIds: r.requiredFacilities.map(facility),
        budgetPerMonth: r.budgetPerMonth,
        notes: r.notes,
      });
    }
  }

  return {
    users: await insertChunked(User, users),
    partners: await insertChunked(Partner, partners),
    learnerProfiles: await insertChunked(LearnerProfile, profiles),
    spaces: await insertChunked(Space, spaces),
    courses: await insertChunked(Course, courses),
    offerings: await insertChunked(CourseOffering, offerings),
    requests: await insertChunked(LearningRequest, requests),
  };
}
