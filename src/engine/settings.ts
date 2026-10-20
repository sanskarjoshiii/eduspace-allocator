import type { EngineSettings, Strategy, Weights } from './types';

/** Strategy presets from README 13.5. */
export const STRATEGY_WEIGHTS: Record<Strategy, Weights> = {
  balanced: { distance: 0.25, time: 0.2, facility: 0.15, capacity: 0.15, cost: 0.1, demand: 0.1, utilisation: 0.05 },
  accessibility: { distance: 0.4, time: 0.2, facility: 0.1, capacity: 0.1, cost: 0.05, demand: 0.1, utilisation: 0.05 },
  reach: { distance: 0.15, time: 0.15, facility: 0.1, capacity: 0.25, cost: 0.05, demand: 0.25, utilisation: 0.05 },
  cost: { distance: 0.15, time: 0.15, facility: 0.1, capacity: 0.15, cost: 0.35, demand: 0.05, utilisation: 0.05 },
};

export const DEFAULT_WEIGHTS: Weights = STRATEGY_WEIGHTS.balanced;

/** Scales weights to sum to 1 (all equal when the sum is not positive). */
export function normaliseWeights(w: Weights): Weights {
  const keys = Object.keys(w) as (keyof Weights)[];
  const sum = keys.reduce((s, k) => s + Math.max(0, w[k]), 0);
  const out = { ...w };
  for (const k of keys) out[k] = sum > 0 ? Math.max(0, w[k]) / sum : 1 / keys.length;
  return out;
}

/** Defaults matching README 13.3 (seed 42, 10 inits, k 2..6). */
export const DEFAULT_SETTINGS: EngineSettings = {
  strategy: 'balanced',
  weights: DEFAULT_WEIGHTS,
  maxRadiusKm: 5,
  minEdgeScore: 0.2,
  seed: 42,
  kMin: 2,
  kMax: 6,
  kInits: 10,
  alternativesToKeep: 3,
  suggestionCount: 3,
};
