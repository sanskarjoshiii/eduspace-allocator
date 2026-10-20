import { Rng } from '../prng';
import { AREAS } from './areas';
import { CATEGORY_POPULARITY, LEAF_CATEGORIES, type LeafCategory } from './categories';

/**
 * SYNTHETIC baseline demand per (area, leaf category): roughly "learners per area who would
 * take this category", derived from the synthetic student count, the category's popularity and
 * a seeded noise term. Not survey data. Fixed seed so it never changes with --seed.
 */
export const DEMAND_SEED = 4242;

export interface DemandSeed {
  areaName: string;
  category: LeafCategory;
  baseline: number;
}

/** Categories whose demand rises in lower-income areas (free tuition, digital access). */
const ACCESS_SKEW: Partial<Record<LeafCategory, number>> = {
  'Mathematics Tuition': 0.6,
  'Science Tuition': 0.5,
  'Digital Literacy': 0.7,
  'Spoken English': 0.5,
  'Financial Literacy': 0.4,
};

function buildDemand(): DemandSeed[] {
  const rng = new Rng(DEMAND_SEED);
  const out: DemandSeed[] = [];
  for (const area of AREAS) {
    const lowIncome = 1 - area.incomeScore / 100;
    for (const category of LEAF_CATEGORIES) {
      const skew = 1 + (ACCESS_SKEW[category] ?? 0) * (lowIncome - 0.4);
      const noise = rng.range(0.6, 1.4);
      const baseline = Math.round((area.studentCount / 1000) * 2.2 * CATEGORY_POPULARITY[category] * skew * noise);
      out.push({ areaName: area.name, category, baseline: Math.max(0, baseline) });
    }
  }
  return out;
}

export const STUDENT_DEMAND: readonly DemandSeed[] = buildDemand();
