import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from '@/lib/db';
import { ROLE_LABEL } from '@/lib/domain';
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
import { emitEvent } from '@/server/services/events';
import { applyPlan, planEmails, type ApplyCounts } from './apply';
import { seedAdmin, seedBase, type AdminOutcome, type BaseResult } from './base';
import { DEFAULT_DEMO_PASSWORD, DEFAULT_SEED, SEED_BCRYPT_COST, type SeedProfile } from './constants';
import { intentMix } from './generate';
import { planForProfile } from './profiles';
import { describeUri, dropEduSpaceCollections, looksLikeProduction } from './reset';
import type { SeedPlan } from './types';

export { SEED_PROFILES, DEMO_ACCOUNTS, E2E_ACCOUNTS, E2E_SCENARIO, DEFAULT_DEMO_PASSWORD, type SeedProfile } from './constants';
export { generatePlan, intentMix } from './generate';
export { buildE2ePlan } from './e2e';
export { planForProfile, PROFILE_CONFIGS } from './profiles';
export { isRequestFeasible } from './feasibility';
export { looksLikeProduction, describeUri } from './reset';
export type { SeedPlan, GeneratorConfig, RequestIntent } from './types';

export interface RunSeedOptions {
  profile?: SeedProfile;
  seed?: number;
  /** Drop every EduSpace collection first. */
  reset?: boolean;
  /** Required with `reset` when the URI looks like a production Atlas host. */
  yesReally?: boolean;
  /** Defaults to process.env.MONGODB_URI. */
  uri?: string;
  adminEmail?: string;
  adminPassword?: string;
  /** Password for named and generated demo accounts. Defaults to DEFAULT_DEMO_PASSWORD. */
  demoPassword?: string;
  /** Anchors "next month" start dates. Defaults to the current time. */
  now?: Date;
  /** Progress output. Defaults to console.log. */
  log?: (line: string) => void;
}

export interface SeedLogin {
  role: string;
  email: string;
  password: string;
}

export interface SeedResult {
  profile: SeedProfile;
  seed: number;
  host: string;
  database: string;
  dropped: string[] | null;
  base: BaseResult['inserted'];
  admin: AdminOutcome;
  profileData: { status: 'inserted'; counts: ApplyCounts } | { status: 'skipped'; reason: string } | { status: 'none' };
  /** The generated plan (null for minimal). Requests carry their intended (in)feasibility. */
  plan: SeedPlan | null;
  mix: ReturnType<typeof intentMix> | null;
  counts: Record<string, number>;
  logins: SeedLogin[];
}

export class SeedRefusedError extends Error {}

/** Collection counts for the summary table. */
export async function collectionCounts(): Promise<Record<string, number>> {
  const byRole = await User.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$role', n: { $sum: 1 } } }]);
  const role = (r: string) => byRole.find((x) => x._id === r)?.n ?? 0;
  return {
    'Users: Administrator': role('Administrator'),
    'Users: Learner': role('Learner'),
    'Users: Space Giver': role('SpaceGiver'),
    'Users: Course Provider': role('CourseProvider'),
    Partners: await Partner.countDocuments(),
    'Learner profiles': await LearnerProfile.countDocuments(),
    Spaces: await Space.countDocuments(),
    Courses: await Course.countDocuments(),
    'Course offerings': await CourseOffering.countDocuments(),
    'Learning requests': await LearningRequest.countDocuments(),
    Areas: await Area.countDocuments(),
    'Student demand rows': await StudentDemand.countDocuments(),
    'Facility types': await FacilityType.countDocuments(),
    'Course categories': await CourseCategory.countDocuments(),
    'System settings': await SystemSetting.countDocuments(),
    'Notification templates': await NotificationTemplate.countDocuments(),
    'Domain events (unprocessed)': await DomainEvent.countDocuments({ processedAt: null }),
  };
}

/** Builds every model's indexes (and drops indexes no schema declares). */
export async function syncAllIndexes(): Promise<void> {
  for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
}

/**
 * Seeds the connected database. Does not disconnect (the CLI does). Order:
 * reset → indexes → lookups, areas, demand, settings, templates → admin → profile data → manual.trigger event.
 */
export async function runSeed(options: RunSeedOptions = {}): Promise<SeedResult> {
  const profile = options.profile ?? 'demo';
  const seed = options.seed ?? DEFAULT_SEED;
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? new Date();
  const uri = options.uri ?? process.env.MONGODB_URI;
  if (!uri) throw new SeedRefusedError('MONGODB_URI is not set. Add it to .env.local or the environment.');
  const target = describeUri(uri);

  if (options.reset && looksLikeProduction(uri) && !options.yesReally) {
    throw new SeedRefusedError(
      `Refusing --reset: ${target.host} looks like a production Atlas host. Pass --yes-really as well if you really mean to wipe "${target.database}".`,
    );
  }

  await connectDb(uri);
  const database = mongoose.connection.db?.databaseName ?? target.database;

  let dropped: string[] | null = null;
  if (options.reset) {
    log(`Resetting: dropping every EduSpace collection in database "${database}" on ${target.host}`);
    dropped = await dropEduSpaceCollections();
    log(`  dropped ${dropped.length} collection(s)${dropped.length ? `: ${dropped.join(', ')}` : ''}`);
  }

  log('Creating indexes');
  await syncAllIndexes();

  log('Seeding lookups, areas, student demand, settings and templates');
  const base = await seedBase();

  const admin = await seedAdmin(options.adminEmail, options.adminPassword);
  if (admin.status === 'skipped') log(`  admin skipped: ${admin.reason}`);
  else log(`  admin ${admin.email}: ${admin.status === 'created' ? 'created' : 'already exists (password left unchanged)'}`);

  const demoPassword = options.demoPassword || DEFAULT_DEMO_PASSWORD;
  const plan = planForProfile(profile, seed, now);
  let profileData: SeedResult['profileData'] = { status: 'none' };
  if (plan) {
    const emails = planEmails(plan);
    const clash = await User.findOne({ email: { $in: emails } }, 'email').lean();
    if (clash) {
      profileData = { status: 'skipped', reason: `${clash.email} already exists; run with --reset to regenerate the ${profile} data` };
      log(`  ${profile} data skipped: ${profileData.reason}`);
    } else {
      log(`Generating ${profile} data (seed ${seed})`);
      const hash = await bcrypt.hash(demoPassword, SEED_BCRYPT_COST);
      const counts = await applyPlan(plan, base.ids, hash, now);
      profileData = { status: 'inserted', counts };
    }
  }

  // Let the first worker tick run Smart Allocation over the fresh data.
  await emitEvent('manual.trigger', null, { source: 'seed', profile, seed });

  const logins: SeedLogin[] = [];
  if (admin.status !== 'skipped') logins.push({ role: 'Administrator', email: admin.email, password: '(ADMIN_SEED_PASSWORD)' });
  if (plan) {
    for (const a of [...plan.spaceGivers.map((g) => g.account), ...plan.providers.map((p) => p.account), ...plan.learners.map((l) => l.account)]) {
      if (a.named) logins.push({ role: ROLE_LABEL[a.role], email: a.email, password: demoPassword });
    }
  }

  return {
    profile,
    seed,
    host: target.host,
    database,
    dropped,
    base: base.inserted,
    admin,
    profileData,
    plan,
    mix: plan ? intentMix(plan) : null,
    counts: await collectionCounts(),
    logins,
  };
}
