/**
 * Seed constants with no runtime dependencies, so Playwright specs and docs can import them
 * without loading Mongoose.
 */

export const SEED_PROFILES = ['minimal', 'demo', 'e2e', 'bench'] as const;
export type SeedProfile = (typeof SEED_PROFILES)[number];

export const DEFAULT_SEED = 42;

/** Password for every generated and named demo account unless SEED_DEMO_PASSWORD is set. */
export const DEFAULT_DEMO_PASSWORD = 'Demo-Pass-2026';

/** bcrypt cost for seeded passwords. Generated accounts share one hash per password. */
export const SEED_BCRYPT_COST = 10;

/** Named accounts present in every profile except "minimal". */
export const DEMO_ACCOUNTS = {
  learner: 'learner@eduspace.local',
  spaceGiver: 'spaces@eduspace.local',
  provider: 'provider@eduspace.local',
} as const;

/** Generated accounts live on this domain, so a reseed can find and skip them. */
export const GENERATED_EMAIL_DOMAIN = 'demo.eduspace.local';

/**
 * The "weekend coding classes in South Pune" end-to-end scenario (PLAN 8.4).
 * 18 learners want Coding on Saturday mornings within 5 km of Kothrud; the one batch has
 * 15 seats, so Smart Allocation should seat 15 and waitlist 3.
 */
export const E2E_SCENARIO = {
  spaceGiverName: 'Kothrud Community Centre',
  spaceName: 'Kothrud Community Centre Computer Lab',
  spaceArea: 'Kothrud',
  seatCapacity: 30,
  computers: 30,
  rentPerHour: 300,
  providerName: 'CodeBridge Pune',
  courseTitle: 'Python Basics',
  category: 'Coding',
  requiredComputers: 15,
  batchSize: 15,
  sessionMinutes: 120,
  window: { dayOfWeek: 6, startTime: '10:00', endTime: '13:00' },
  durationWeeks: 8,
  maxRentPerHour: 400,
  feePerMonth: 500,
  learnerCount: 18,
  maxDistanceKm: 5,
  expectedSeated: 15,
  expectedWaitlisted: 3,
} as const;

/** Fixed logins for Playwright. All use the demo password; the admin comes from ADMIN_SEED_*. */
export const E2E_ACCOUNTS = {
  /** Learner 1 of 18: lives closest to the centre and has a Coding request. */
  learner: DEMO_ACCOUNTS.learner,
  /** Owns Kothrud Community Centre. */
  spaceGiver: DEMO_ACCOUNTS.spaceGiver,
  /** Owns CodeBridge Pune and Python Basics. */
  provider: DEMO_ACCOUNTS.provider,
  /** A Kothrud learner with a profile and no request, for "submit a request in the browser" flows. */
  freshLearner: 'fresh.learner@eduspace.local',
  /** Learners 2..18 are e2e.learner02@eduspace.local … e2e.learner18@eduspace.local. */
  otherLearner: (n: number) => `e2e.learner${String(n).padStart(2, '0')}@eduspace.local`,
} as const;

/** Defaults the Playwright setup uses when ADMIN_SEED_* are not set. */
export const E2E_ADMIN_DEFAULTS = {
  email: 'admin@eduspace.local',
  password: 'Admin-Pass-2026',
} as const;
