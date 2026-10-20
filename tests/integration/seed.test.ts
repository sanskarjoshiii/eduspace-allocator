import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import type { Model } from 'mongoose';
import {
  Area,
  Course,
  CourseCategory,
  CourseOffering,
  DomainEvent,
  FacilityType,
  LearnerProfile,
  LearningRequest,
  NotificationTemplate,
  Partner,
  Space,
  StudentDemand,
  SystemSetting,
  User,
} from '@/server/models';
import { DEFAULT_SETTINGS } from '@/server/services/settings';
import { DEFAULT_TEMPLATES } from '@/server/notifications/defaults';
import {
  DEFAULT_DEMO_PASSWORD,
  DEMO_ACCOUNTS,
  E2E_ACCOUNTS,
  E2E_SCENARIO,
  PROFILE_CONFIGS,
  SeedRefusedError,
  generatePlan,
  isRequestFeasible,
  runSeed,
  type RunSeedOptions,
} from '@/server/seed';
import { haversineKm } from '@/server/seed/geo';

const NOW = new Date('2026-10-16T06:00:00Z');
const ADMIN = { adminEmail: 'Admin@EduSpace.local', adminPassword: 'Admin-Pass-2026' };
const quiet: RunSeedOptions = { log: () => undefined, now: NOW, ...ADMIN };

async function adminHash(): Promise<string> {
  const admin = await User.findOne({ role: 'Administrator' }).select('+passwordHash').lean();
  return admin!.passwordHash;
}

async function snapshot() {
  const [spaces, users, offerings, requests] = await Promise.all([
    Space.find({}, 'name seatCapacity policy.rentPerHour').lean(),
    User.find({}, 'email name role').lean(),
    CourseOffering.find({}, 'title batchSize sessionMinutes windows').lean(),
    LearningRequest.find({}, 'maxDistanceKm location.coordinates startMonth').lean(),
  ]);
  return {
    spaces: spaces.map((s) => `${s.name}|${s.seatCapacity}|${s.policy?.rentPerHour}`).sort(),
    users: users.map((u) => `${u.email}|${u.name}|${u.role}`).sort(),
    offerings: offerings.map((o) => `${o.title}|${o.batchSize}|${o.sessionMinutes}|${JSON.stringify(o.windows)}`).sort(),
    requests: requests.map((r) => `${r.maxDistanceKm}|${r.location.coordinates.join(',')}|${r.startMonth}`).sort(),
  };
}

describe('seed: minimal profile', () => {
  it('creates lookups, areas, settings, templates and one admin; a second run duplicates nothing', async () => {
    const first = await runSeed({ ...quiet, profile: 'minimal', reset: true });
    expect(first.admin).toEqual({ status: 'created', email: 'admin@eduspace.local' });
    expect(first.profileData).toEqual({ status: 'none' });
    expect(await FacilityType.countDocuments()).toBe(10);
    expect(await CourseCategory.countDocuments()).toBe(21);
    expect(await CourseCategory.countDocuments({ parentId: null })).toBe(6);
    expect(await Area.countDocuments()).toBe(24);
    expect(await StudentDemand.countDocuments()).toBe(24 * 15);
    expect(await SystemSetting.countDocuments()).toBe(Object.keys(DEFAULT_SETTINGS).length);
    expect(await NotificationTemplate.countDocuments()).toBe(DEFAULT_TEMPLATES.length);
    expect(await User.countDocuments()).toBe(1);
    expect(await DomainEvent.countDocuments({ type: 'manual.trigger', processedAt: null })).toBe(1);

    const coding = await CourseCategory.findOne({ name: 'Coding' }).lean();
    const technology = await CourseCategory.findOne({ name: 'Technology' }).lean();
    expect(coding?.parentId?.toString()).toBe(technology?._id.toString());
    const setting = await SystemSetting.findOne({ key: 'maxRadiusKm' }).lean();
    expect(setting?.description).toMatch(/maximum distance/i);

    // An administrator edits a setting and a template, then the seed runs again with a different password.
    await SystemSetting.updateOne({ key: 'maxRadiusKm' }, { $set: { value: 7 } });
    await NotificationTemplate.updateOne({ type: 'offer.sent', role: 'Learner' }, { $set: { titleTemplate: 'Edited' } });
    const hashBefore = await adminHash();

    const second = await runSeed({ ...quiet, profile: 'minimal', adminPassword: 'Another-Pass-2026' });
    expect(second.admin).toEqual({ status: 'exists', email: 'admin@eduspace.local' });
    expect(Object.values(second.base).every((n) => n === 0)).toBe(true);
    expect(await User.countDocuments({ role: 'Administrator' })).toBe(1);
    expect(await adminHash()).toBe(hashBefore);
    expect(await bcrypt.compare('Admin-Pass-2026', hashBefore)).toBe(true);
    expect((await SystemSetting.findOne({ key: 'maxRadiusKm' }).lean())?.value).toBe(7);
    expect((await NotificationTemplate.findOne({ type: 'offer.sent', role: 'Learner' }).lean())?.titleTemplate).toBe('Edited');
    expect(await SystemSetting.countDocuments()).toBe(Object.keys(DEFAULT_SETTINGS).length);
  });

  it('skips the admin with a clear reason when ADMIN_SEED_* are missing', async () => {
    const result = await runSeed({ log: () => undefined, now: NOW, profile: 'minimal', reset: true });
    expect(result.admin.status).toBe('skipped');
    expect(result.admin.status === 'skipped' && result.admin.reason).toMatch(/ADMIN_SEED_EMAIL/);
    expect(await User.countDocuments()).toBe(0);
  });

  it('refuses --reset against an Atlas host without --yes-really', async () => {
    await expect(runSeed({ ...quiet, uri: 'mongodb+srv://u:p@cluster0.abcd.mongodb.net/eduspace', reset: true })).rejects.toBeInstanceOf(SeedRefusedError);
  });
});

describe('seed: demo profile', () => {
  it('passes every model validator and has the requested feasible / infeasible mix', async () => {
    const result = await runSeed({ ...quiet, profile: 'demo', reset: true });
    expect(result.profileData.status).toBe('inserted');
    expect(result.counts.Spaces).toBe(15);
    expect(result.counts['Course offerings']).toBe(10);
    expect(result.counts['Learning requests']).toBe(100);
    expect(result.counts['Users: Learner']).toBe(80);
    expect(result.counts['Users: Space Giver']).toBe(6);
    expect(result.counts['Users: Course Provider']).toBe(6);

    // 75% feasible; the infeasible quarter covers every reason.
    const mix = result.mix!;
    expect(mix.total).toBe(100);
    expect(mix.feasible).toBe(75);
    for (const reason of ['far', 'category', 'budget', 'facility', 'time'] as const) expect(mix[reason]).toBeGreaterThan(0);
    const plan = result.plan!;
    for (const learner of plan.learners) {
      for (const req of learner.requests) expect(isRequestFeasible(plan, req)).toBe(req.intent === 'feasible');
    }

    // Re-run validation on what was stored (insertMany already validated on the way in).
    const models = [User, Partner, LearnerProfile, Space, Course, CourseOffering, LearningRequest, Area, StudentDemand] as unknown as Model<unknown>[];
    for (const model of models) {
      for (const doc of await model.find()) await expect(doc.validate()).resolves.toBeUndefined();
    }

    // Spaces: facilities never report more working units than exist; slots never overlap (checked by validate above).
    for (const s of await Space.find().lean()) {
      for (const f of s.facilities) expect(f.workingQuantity).toBeLessThanOrEqual(f.quantity);
      expect(s.policy?.rentPerHour).toBeGreaterThanOrEqual(0);
      expect(s.policy?.rentPerHour).toBeLessThanOrEqual(800);
    }
    for (const o of await CourseOffering.find().lean()) {
      expect(o.batchSize).toBeGreaterThanOrEqual(8);
      expect(o.batchSize).toBeLessThanOrEqual(30);
      expect(o.sessionMinutes).toBeGreaterThanOrEqual(60);
      expect(o.sessionMinutes).toBeLessThanOrEqual(180);
      expect(o.startDate.getTime()).toBeGreaterThanOrEqual(Date.UTC(2026, 10, 1));
    }

    // Named demo accounts, linked to their records, with the demo password.
    const learner = await User.findOne({ email: DEMO_ACCOUNTS.learner }).select('+passwordHash').lean();
    expect(learner?.role).toBe('Learner');
    expect(await bcrypt.compare(DEFAULT_DEMO_PASSWORD, learner!.passwordHash)).toBe(true);
    const profile = await LearnerProfile.findById(learner!.ownerRefId).lean();
    const kothrud = await Area.findOne({ name: 'Kothrud' }).lean();
    expect(profile?.areaId?.toString()).toBe(kothrud!._id.toString());
    const spaces = await User.findOne({ email: DEMO_ACCOUNTS.spaceGiver }).lean();
    expect(await Space.countDocuments({ ownerUserId: spaces!._id })).toBeGreaterThan(0);
    const provider = await User.findOne({ email: DEMO_ACCOUNTS.provider }).lean();
    expect(await CourseOffering.countDocuments({ providerUserId: provider!._id })).toBeGreaterThan(0);

    // A second run without --reset leaves the demo data alone.
    const again = await runSeed({ ...quiet, profile: 'demo' });
    expect(again.profileData.status).toBe('skipped');
    expect(await LearningRequest.countDocuments()).toBe(100);
  });
});

describe('seed: e2e profile', () => {
  it('builds exactly the weekend coding scenario in South Pune', async () => {
    await runSeed({ ...quiet, profile: 'e2e', reset: true });
    const s = E2E_SCENARIO;

    expect(await Space.countDocuments()).toBe(1);
    const space = (await Space.findOne().lean())!;
    const giver = await Partner.findById(space.partnerId).lean();
    expect(giver?.name).toBe(s.spaceGiverName);
    expect(space.name).toBe(s.spaceName);
    expect(space.seatCapacity).toBe(30);
    expect((await Area.findById(space.areaId).lean())?.name).toBe('Kothrud');
    const computers = (await FacilityType.findOne({ name: 'Computers' }).lean())!;
    const lab = space.facilities.find((f) => f.facilityTypeId.toString() === computers._id.toString());
    expect(lab).toMatchObject({ quantity: 30, workingQuantity: 30 });
    expect(space.slots.map((x) => [x.dayOfWeek, x.startTime, x.endTime, x.isBlocked])).toEqual([
      [0, '09:00', '18:00', false],
      [6, '09:00', '18:00', false],
    ]);
    expect(space.policy).toMatchObject({ approvalMode: 'auto', rentPerHour: 300 });
    expect((await User.findById(space.ownerUserId).lean())?.email).toBe(E2E_ACCOUNTS.spaceGiver);

    expect(await CourseOffering.countDocuments()).toBe(1);
    const course = (await Course.findOne().lean())!;
    expect(course.title).toBe('Python Basics');
    expect((await Partner.findById(course.partnerId).lean())?.name).toBe('CodeBridge Pune');
    expect((await CourseCategory.findById(course.categoryId).lean())?.name).toBe('Coding');
    expect(course.requirements.map((r) => [r.facilityTypeId.toString(), r.minQuantity])).toEqual([[computers._id.toString(), 15]]);
    const offering = (await CourseOffering.findOne().lean())!;
    expect(offering).toMatchObject({ batchSize: 15, sessionMinutes: 120, durationWeeks: 8, status: 'Open', maxRentPerHour: 400 });
    expect(offering.windows).toEqual([{ dayOfWeek: 6, startTime: '10:00', endTime: '13:00' }]);
    expect(offering.startDate.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(offering.targetAreaId?.toString()).toBe(space.areaId.toString());

    const requests = await LearningRequest.find().lean();
    expect(requests).toHaveLength(18);
    const areaNames = new Map((await Area.find().lean()).map((a) => [a._id.toString(), a.name]));
    const distances: { area: string; km: number }[] = [];
    for (const r of requests) {
      expect(['Kothrud', 'Karve Nagar', 'Warje']).toContain(areaNames.get(r.areaId.toString()));
      expect(r.categoryId.toString()).toBe(course.categoryId.toString());
      expect(r.maxDistanceKm).toBe(5);
      expect(r.status).toBe('Submitted');
      expect(r.windows.every((w) => w.dayOfWeek === 6 && w.startTime <= '10:00' && w.endTime >= '13:00')).toBe(true);
      const km = haversineKm(r.location.coordinates as [number, number], space.location.coordinates as [number, number]);
      expect(km).toBeLessThanOrEqual(5);
      distances.push({ area: areaNames.get(r.areaId.toString())!, km });
    }
    // 18 learners for 15 seats: the three farthest (all in Warje) are the expected waitlist.
    const farthest = distances.sort((a, b) => b.km - a.km).slice(0, s.expectedWaitlisted);
    expect(farthest.every((d) => d.area === 'Warje')).toBe(true);

    // Fixed logins.
    const learner = (await User.findOne({ email: E2E_ACCOUNTS.learner }).lean())!;
    expect(await LearningRequest.countDocuments({ learnerUserId: learner._id })).toBe(1);
    const fresh = (await User.findOne({ email: E2E_ACCOUNTS.freshLearner }).lean())!;
    expect(await LearningRequest.countDocuments({ learnerUserId: fresh._id })).toBe(0);
    expect(await User.countDocuments({ email: E2E_ACCOUNTS.otherLearner(18) })).toBe(1);
    expect(await User.countDocuments({ email: E2E_ACCOUNTS.provider, role: 'CourseProvider' })).toBe(1);
    expect(await User.countDocuments({ role: 'Administrator' })).toBe(1);
  });
});

describe('seed: reproducibility', () => {
  it('generates an identical plan for the same seed and a different one for another seed', () => {
    const a = generatePlan({ ...PROFILE_CONFIGS.demo, seed: 7 }, NOW);
    const b = generatePlan({ ...PROFILE_CONFIGS.demo, seed: 7 }, NOW);
    const c = generatePlan({ ...PROFILE_CONFIGS.demo, seed: 8 }, NOW);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('stores the same counts and names for the same seed', async () => {
    const first = await runSeed({ ...quiet, profile: 'demo', seed: 7, reset: true });
    const before = await snapshot();
    const second = await runSeed({ ...quiet, profile: 'demo', seed: 7, reset: true });
    expect(second.counts).toEqual(first.counts);
    expect(await snapshot()).toEqual(before);
  });
});
