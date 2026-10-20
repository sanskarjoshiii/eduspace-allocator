import { z } from 'zod';
import { STRATEGIES } from '@/lib/domain';
import type { Settings } from '@/server/services/settings';

// Client-safe mirror of SettingsSchema (src/server/services/settings.ts) so settings forms can
// import it without pulling Mongoose into the browser bundle. The bounds match the server schema;
// updateSettings() re-validates with SettingsSchema before anything is stored.

const weight = z.number().min(0, 'Weights cannot be negative').max(1, 'Each weight is at most 1');

export const WeightsInput = z.object({
  distance: weight,
  time: weight,
  facility: weight,
  capacity: weight,
  cost: weight,
  demand: weight,
  utilisation: weight,
});
export type WeightsInput = z.infer<typeof WeightsInput>;

const SettingsFields = z.object({
  strategy: z.enum(STRATEGIES),
  strategies: z.partialRecord(z.enum(STRATEGIES), WeightsInput),
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

const WEIGHT_SUM_MIN = 0.99;
const WEIGHT_SUM_MAX = 1.01;

export const weightSum = (w: WeightsInput): number => Object.values(w).reduce((a, b) => a + b, 0);

/**
 * PATCH /api/settings body: any subset of settings, plus `normalise: true` to rescale
 * weight sets that do not sum to 1. Without it, a weight set must sum to 0.99–1.01.
 * A set of all zeros is always rejected.
 */
export const SettingsPatchInput = SettingsFields.partial()
  .extend({ normalise: z.boolean().optional() })
  .superRefine((v, ctx) => {
    for (const [name, w] of Object.entries(v.strategies ?? {})) {
      if (!w) continue;
      const sum = weightSum(w);
      if (sum <= 0) {
        ctx.addIssue({ code: 'custom', path: ['strategies', name], message: 'At least one weight must be above zero' });
      } else if (!v.normalise && (sum < WEIGHT_SUM_MIN || sum > WEIGHT_SUM_MAX)) {
        ctx.addIssue({
          code: 'custom',
          path: ['strategies', name],
          message: `Weights must add up to 1 (they add up to ${sum.toFixed(2)}). Adjust them or choose Normalise.`,
        });
      }
    }
    if (v.kMin !== undefined && v.kMax !== undefined && v.kMin > v.kMax) {
      ctx.addIssue({ code: 'custom', path: ['kMin'], message: 'Smallest cluster count cannot be larger than the largest' });
    }
  });
export type SettingsPatchInput = z.infer<typeof SettingsPatchInput>;

// Compile-time guard: the mirror must stay assignable to the server's Settings type.
type _Check = Omit<SettingsPatchInput, 'normalise' | 'strategies'> extends Partial<Omit<Settings, 'strategies'>> ? true : never;
export const _settingsMirrorOk: _Check = true;
