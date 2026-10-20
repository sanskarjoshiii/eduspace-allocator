import type { SeedProfile } from './constants';
import { buildE2ePlan } from './e2e';
import { generatePlan } from './generate';
import type { GeneratorConfig, SeedPlan } from './types';

/** Generator settings per profile (seed is added at run time). */
export const PROFILE_CONFIGS: Record<'demo' | 'bench', Omit<GeneratorConfig, 'seed'>> = {
  // ~6 space givers / 15 spaces, 6 providers / 9 courses / 10 offerings, 80 learners / 100 requests.
  demo: {
    spaceGivers: 6,
    spacesPerGiver: 2.5,
    providers: 6,
    coursesPerProvider: 1.5,
    offeringsPerCourse: 1.12,
    learners: 80,
    requestsPerLearner: 1.25,
    feasibleRatio: 0.75,
    namedAccounts: true,
  },
  // Engine benchmark size (README 21): 500 spaces, 2,000 requests.
  bench: {
    spaceGivers: 100,
    spacesPerGiver: 5,
    providers: 60,
    coursesPerProvider: 2,
    offeringsPerCourse: 1.5,
    learners: 1600,
    requestsPerLearner: 1.25,
    feasibleRatio: 0.75,
    namedAccounts: true,
  },
};

/** The plan for a profile, or null for "minimal" (base data only). */
export function planForProfile(profile: SeedProfile, seed: number, now: Date = new Date()): SeedPlan | null {
  switch (profile) {
    case 'minimal':
      return null;
    case 'e2e':
      return buildE2ePlan(now);
    case 'demo':
    case 'bench':
      return generatePlan({ ...PROFILE_CONFIGS[profile], seed }, now);
  }
}
