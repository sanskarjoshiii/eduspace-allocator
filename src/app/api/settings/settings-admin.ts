// Settings read and update for the Settings screen (PLAN 7.7). Lives beside the route because
// src/server/services/settings.ts is foundation code; this module only composes it.

import { ZodError } from 'zod';
import { SystemSetting } from '@/server/models';
import { STRATEGIES, STRATEGY_LABEL, type Strategy } from '@/lib/domain';
import { badRequest } from '@/server/http';
import { audit, diffOf } from '@/server/services/audit';
import {
  DEFAULT_SETTINGS, DEFAULT_STRATEGIES, SETTING_DESCRIPTIONS, getSettings, normaliseWeights, updateSettings,
  type Settings, type SettingKey, type Weights,
} from '@/server/services/settings';
import type { SettingsPatchInput } from '@/schemas/settings';
import type { SessionUser } from '@/server/auth/session';

export interface SettingsView {
  values: Settings;
  defaults: Settings;
  descriptions: Record<SettingKey, string>;
  /** Strategy presets with their labels and default weights, for the preset picker. */
  presets: { key: Strategy; label: string; defaultWeights: Weights; weights: Weights }[];
  /** Weights the next run will use (active strategy, normalised to sum to 1). */
  activeWeights: Weights;
  /** Last change per stored key. */
  updated: Partial<Record<SettingKey, { at: string; by: string | null }>>;
}

export async function settingsView(): Promise<SettingsView> {
  const values = await getSettings();
  const stored = await SystemSetting.find({ key: { $in: Object.keys(DEFAULT_SETTINGS) } }).select('key updatedAt updatedBy').lean();
  const updated: SettingsView['updated'] = {};
  for (const s of stored) {
    updated[s.key as SettingKey] = { at: new Date(s.updatedAt).toISOString(), by: s.updatedBy?.toString() ?? null };
  }
  return {
    values,
    defaults: DEFAULT_SETTINGS,
    descriptions: SETTING_DESCRIPTIONS,
    presets: STRATEGIES.map((key) => ({
      key,
      label: STRATEGY_LABEL[key],
      defaultWeights: DEFAULT_STRATEGIES[key],
      weights: values.strategies[key] ?? DEFAULT_STRATEGIES[key],
    })),
    activeWeights: normaliseWeights(values.strategies[values.strategy] ?? DEFAULT_STRATEGIES.balanced),
    updated,
  };
}

/** Validates, optionally normalises weights, saves and audits a settings change. Returns the new view and changed keys. */
export async function patchSettings(actor: SessionUser, input: SettingsPatchInput): Promise<{ changed: SettingKey[]; settings: SettingsView }> {
  const { normalise, strategies, ...rest } = input;
  const current = await getSettings();
  const patch: Partial<Settings> = { ...rest };
  if (strategies) {
    const merged = { ...current.strategies };
    for (const [k, w] of Object.entries(strategies) as [Strategy, Weights | undefined][]) {
      if (!w) continue;
      merged[k] = normalise ? roundWeights(normaliseWeights(w)) : w;
    }
    patch.strategies = merged;
  }
  const kMin = patch.kMin ?? current.kMin;
  const kMax = patch.kMax ?? current.kMax;
  if (kMin > kMax) {
    throw new ZodError([{ code: 'custom', path: ['kMin'], message: 'Smallest cluster count cannot be larger than the largest', input: kMin }]);
  }

  let changed: SettingKey[];
  try {
    changed = await updateSettings(patch, actor.id);
  } catch (err) {
    if (err instanceof ZodError) throw err;
    throw badRequest((err as Error).message);
  }
  if (changed.length > 0) {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const next = await getSettings();
    for (const k of changed) {
      before[k] = current[k];
      after[k] = next[k];
    }
    await audit({ actor, action: 'update', entity: 'SystemSetting', diff: diffOf(before, after) });
  }
  return { changed, settings: await settingsView() };
}

/** Rounds normalised weights to 4 decimals, keeping the sum at 1 by adjusting the largest. */
function roundWeights(w: Weights): Weights {
  const entries = Object.entries(w).map(([k, v]) => [k, Math.round(v * 10_000) / 10_000] as [keyof Weights, number]);
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  const largest = entries.reduce((m, e) => (e[1] > m[1] ? e : m), entries[0]!);
  largest[1] = Math.round((largest[1] + (1 - sum)) * 10_000) / 10_000;
  return Object.fromEntries(entries) as unknown as Weights;
}
