// Shared helpers for the administration screens (settings, lookups, users, templates, audit logs).

import { ApiError } from '@/lib/api';
import type { Strategy } from '@/lib/domain';
import type { WeightsInput } from '@/schemas/settings';

export type WeightKey = keyof WeightsInput;

/** Engine order of the seven Smart Allocation criteria. */
export const WEIGHT_KEYS: readonly WeightKey[] = ['distance', 'time', 'facility', 'capacity', 'cost', 'demand', 'utilisation'];

export const WEIGHT_LABEL: Record<WeightKey, string> = {
  distance: 'Distance',
  time: 'Time Fit',
  facility: 'Facilities',
  capacity: 'Capacity',
  cost: 'Cost',
  demand: 'Demand',
  utilisation: 'Utilisation',
};

/** Human labels for setting keys (shown in "changed" summaries and audit diffs). */
export const SETTING_LABEL: Record<string, string> = {
  strategy: 'Strategy',
  strategies: 'Strategy weights',
  maxRadiusKm: 'Maximum radius',
  minEdgeScore: 'Minimum compatibility score',
  debounceSeconds: 'Run delay',
  offerExpiryHours: 'Offer expiry',
  offerExpiringNoticeHours: 'Expiry reminder',
  runLockTtlSeconds: 'Run lock timeout',
  maxRunRetries: 'Automatic retries',
  alertMinAreas: 'Alert minimum areas',
  alertMinRequests: 'Alert minimum requests',
  alertWindowDays: 'Alert window',
  kMin: 'Fewest demand groups',
  kMax: 'Most demand groups',
  kInits: 'Grouping attempts',
  seed: 'Grouping seed',
  emailEnabled: 'Email notifications',
  requirePartnerApproval: 'Partner approval',
};

export const settingLabel = (key: string): string => SETTING_LABEL[key] ?? humanize(key);

/** "allocation.approvalNeeded" → "Allocation approval needed"; "ownerUserId" → "Owner user id". */
export function humanize(value: string): string {
  const spaced = value
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Sum of a weight set, tolerant of empty inputs while typing. */
export function weightTotal(w: Partial<Record<WeightKey, number | undefined>> | undefined): number {
  return WEIGHT_KEYS.reduce((sum, k) => sum + (Number.isFinite(w?.[k]) ? (w?.[k] as number) : 0), 0);
}

export const isBalanced = (total: number): boolean => total >= 0.99 && total <= 1.01;

/** Top four weights plus "Other", so a SegmentBar keeps to five parts. */
type SegTone = 'accent' | 'success' | 'info' | 'sky' | 'neutral';
export function weightSegments(w: WeightsInput): { label: string; value: number; tone: SegTone }[] {
  const tones: readonly SegTone[] = ['accent', 'success', 'info', 'sky'];
  const sorted = WEIGHT_KEYS.map((k) => ({ k, v: w[k] })).sort((a, b) => b.v - a.v);
  const top = sorted.slice(0, 4).map((e, i): { label: string; value: number; tone: SegTone } => ({ label: WEIGHT_LABEL[e.k], value: e.v, tone: tones[i] ?? 'neutral' }));
  const rest = sorted.slice(4).reduce((s, e) => s + e.v, 0);
  return rest > 0 ? [...top, { label: 'Other', value: rest, tone: 'neutral' }] : top;
}

export const STRATEGY_DESCRIPTION: Record<Strategy, string> = {
  balanced: 'Weighs distance, timing, facilities and capacity evenly.',
  accessibility: 'Keeps classes as close to learners as possible.',
  reach: 'Places the most learners and favours high-demand areas.',
  cost: 'Prefers lower rent so classes stay affordable.',
};

/** The message to show for a failed delete: 409 explains what still references the record. */
export function deleteErrorMessage(err: unknown, noun: string): string {
  if (err instanceof ApiError && err.status === 409) {
    const usedBy = (err.details as { usedBy?: string[] } | undefined)?.usedBy;
    if (usedBy && usedBy.length > 0) {
      return `This ${noun} cannot be deleted because it is still used by ${usedBy.join(', ')}. Remove or change those records first.`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : `The ${noun} could not be deleted. Try again in a moment.`;
}

/** Flattens an audit diff into from → to rows. Handles `{ key: { from, to } }`, nested objects and plain values. */
export interface DiffRow {
  field: string;
  from: unknown;
  to: unknown;
  hasFrom: boolean;
}

function isFromTo(v: unknown): v is { from?: unknown; to?: unknown } {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && ('from' in (v as object) || 'to' in (v as object));
}

export function diffRows(diff: unknown, prefix = ''): DiffRow[] {
  if (diff === null || diff === undefined) return [];
  if (typeof diff !== 'object' || Array.isArray(diff)) return [{ field: prefix || 'value', from: undefined, to: diff, hasFrom: false }];
  const rows: DiffRow[] = [];
  for (const [key, value] of Object.entries(diff as Record<string, unknown>)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (isFromTo(value)) {
      rows.push({ field, from: value.from, to: value.to, hasFrom: 'from' in value });
    } else if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.keys(value).length <= 12) {
      rows.push(...diffRows(value, field));
    } else {
      rows.push({ field, from: undefined, to: value, hasFrom: false });
    }
  }
  return rows;
}

/** Compact display text for a diff value. */
export function diffValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'empty';
  if (typeof v === 'string') return v === '' ? 'empty' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 160 ? `${s.slice(0, 157)}...` : s;
  } catch {
    return String(v);
  }
}
