import { z } from 'zod';
import { SystemSetting } from '@/server/models';
import { STRATEGIES, type Strategy } from '@/lib/domain';

export const WeightsSchema = z.object({
  distance: z.number().min(0).max(1),
  time: z.number().min(0).max(1),
  facility: z.number().min(0).max(1),
  capacity: z.number().min(0).max(1),
  cost: z.number().min(0).max(1),
  demand: z.number().min(0).max(1),
  utilisation: z.number().min(0).max(1),
});
export type Weights = z.infer<typeof WeightsSchema>;

/** Every tunable value. Stored one key per document in systemSettings. */
export const SettingsSchema = z.object({
  strategy: z.enum(STRATEGIES),
  strategies: z.record(z.enum(STRATEGIES), WeightsSchema),
  maxRadiusKm: z.number().min(1).max(100),
  minEdgeScore: z.number().min(0).max(1),
  debounceSeconds: z.number().int().min(0).max(3600),
  offerExpiryHours: z.number().int().min(1).max(24 * 30),
  offerExpiringNoticeHours: z.number().int().min(1).max(72),
  runLockTtlSeconds: z.number().int().min(30).max(3600),
  maxRunRetries: z.number().int().min(0).max(10),
  alertMinAreas: z.number().int().min(1).max(50),
  alertMinRequests: z.number().int().min(1).max(1000),
  alertWindowDays: z.number().int().min(1).max(365),
  kMin: z.number().int().min(2).max(10),
  kMax: z.number().int().min(2).max(12),
  kInits: z.number().int().min(1).max(50),
  seed: z.number().int(),
  emailEnabled: z.boolean(),
  requirePartnerApproval: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_STRATEGIES: Record<Strategy, Weights> = {
  balanced: { distance: 0.25, time: 0.2, facility: 0.15, capacity: 0.15, cost: 0.1, demand: 0.1, utilisation: 0.05 },
  accessibility: { distance: 0.4, time: 0.2, facility: 0.1, capacity: 0.1, cost: 0.05, demand: 0.1, utilisation: 0.05 },
  reach: { distance: 0.15, time: 0.15, facility: 0.1, capacity: 0.25, cost: 0.05, demand: 0.25, utilisation: 0.05 },
  cost: { distance: 0.15, time: 0.15, facility: 0.1, capacity: 0.15, cost: 0.35, demand: 0.05, utilisation: 0.05 },
};

export const DEFAULT_SETTINGS: Settings = {
  strategy: 'balanced',
  strategies: DEFAULT_STRATEGIES,
  maxRadiusKm: 10,
  minEdgeScore: 0.2,
  debounceSeconds: 30,
  offerExpiryHours: 72,
  offerExpiringNoticeHours: 24,
  runLockTtlSeconds: 600,
  maxRunRetries: 2,
  alertMinAreas: 3,
  alertMinRequests: 10,
  alertWindowDays: 14,
  kMin: 2,
  kMax: 6,
  kInits: 10,
  seed: 42,
  emailEnabled: false,
  requirePartnerApproval: false,
};

export const SETTING_DESCRIPTIONS: Record<SettingKey, string> = {
  strategy: 'Active scoring strategy for Smart Allocation.',
  strategies: 'Weights per strategy. Each set is normalised to sum to 1.',
  maxRadiusKm: 'Global maximum distance between a learner and a space.',
  minEdgeScore: 'Space–offering pairs scoring below this are not matched.',
  debounceSeconds: 'Wait this long after the last submission before starting a run.',
  offerExpiryHours: 'How long a learner has to accept an offer.',
  offerExpiringNoticeHours: 'Send an "offer expiring" reminder this many hours before expiry.',
  runLockTtlSeconds: 'A run lock older than this is considered dead and released.',
  maxRunRetries: 'Automatic retries for a failed run.',
  alertMinAreas: 'Multi-area alert: minimum number of areas (N).',
  alertMinRequests: 'Multi-area alert: minimum open requests per area (M).',
  alertWindowDays: 'Multi-area alert: look-back window in days (W).',
  kMin: 'Smallest number of demand clusters to try.',
  kMax: 'Largest number of demand clusters to try.',
  kInits: 'Attempts per demand grouping; the tightest grouping is kept.',
  seed: 'Random seed for clustering, so runs are reproducible.',
  emailEnabled: 'Send email copies of notifications (needs Resend configured).',
  requirePartnerApproval: 'New Space Giver and Course Provider accounts wait for Administrator approval.',
};

/** Reads all settings, filling gaps with defaults. Invalid stored values fall back to the default. */
export async function getSettings(): Promise<Settings> {
  const docs = await SystemSetting.find({ key: { $in: Object.keys(DEFAULT_SETTINGS) } }).lean();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const d of docs) merged[d.key] = d.value;
  const parsed = SettingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  // Fall back key by key so one bad value does not disable the rest.
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    const single = SettingsSchema.shape[key].safeParse(merged[key]);
    if (single.success) out[key] = single.data;
  }
  return out as Settings;
}

/** Normalises a weight set so it sums to 1. */
export function normaliseWeights(w: Weights): Weights {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum <= 0) return DEFAULT_STRATEGIES.balanced;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / sum])) as Weights;
}

export async function activeWeights(settings?: Settings): Promise<Weights> {
  const s = settings ?? (await getSettings());
  return normaliseWeights(s.strategies[s.strategy] ?? DEFAULT_STRATEGIES.balanced);
}

/** Validates and saves a partial settings update. Returns the keys that changed. */
export async function updateSettings(patch: Partial<Settings>, updatedBy: string | null): Promise<SettingKey[]> {
  const current = await getSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  if (next.kMin > next.kMax) throw new Error('kMin cannot be larger than kMax');
  const changed: SettingKey[] = [];
  for (const key of Object.keys(patch) as SettingKey[]) {
    if (JSON.stringify(current[key]) === JSON.stringify(next[key])) continue;
    await SystemSetting.updateOne(
      { key },
      { $set: { value: next[key], description: SETTING_DESCRIPTIONS[key], updatedBy } },
      { upsert: true },
    );
    changed.push(key);
  }
  return changed;
}
