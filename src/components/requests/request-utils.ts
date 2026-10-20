// Client helpers for learning requests: DTO types (type-only), labels and the status timeline builder.

import type { TimelineStep } from '@/components/ui';
import { formatDate, formatWindow } from '@/lib/format';
import type { MatchedRequestDto, RequestDto, RequestFullDto, TimelineEntry } from '@/server/dto/request';
import type { RecommendationItem, RecommendationResult } from '@/server/services/recommendations';

export type { MatchedRequestDto, RequestDto, RequestFullDto, TimelineEntry, RecommendationItem, RecommendationResult };

export type RequestWindow = RequestFullDto['windows'][number];

export const requestKeys = {
  all: ['requests'] as const,
  mine: (params: object) => ['requests', 'mine', params] as const,
  list: (params: object) => ['requests', 'list', params] as const,
  matched: (params: object) => ['requests', 'matched', params] as const,
  detail: (id: string) => ['requests', 'detail', id] as const,
  recommendations: (id: string) => ['recommendations', id] as const,
};

/** Statuses in which a request can no longer be cancelled. */
export const CLOSED_REQUEST_STATUSES = ['Completed', 'Declined', 'Expired', 'Cancelled'] as const;

export function isClosed(status: string): boolean {
  return (CLOSED_REQUEST_STATUSES as readonly string[]).includes(status);
}

/** "Sat 10:00–12:00, Sun 09:00–11:00", or "Flexible" when empty. */
export function formatWindows(windows: readonly RequestWindow[] | undefined | null, empty = 'Flexible'): string {
  if (!windows || windows.length === 0) return empty;
  return [...windows]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
    .map((w) => formatWindow(w))
    .join(', ');
}

const MONTH_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-11" → "Nov 2026". */
export function formatMonth(ym: string | null | undefined): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return '—';
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return MONTH_FMT.format(new Date(Date.UTC(y, m - 1, 1)));
}

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Category options as "Parent / Child" paths, sorted, from lookups that carry parentId. */
export function categoryOptions(categories: readonly { id: string; name: string; parentId?: string | null }[]): { value: string; label: string }[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path = (id: string, seen = new Set<string>()): string => {
    const c = byId.get(id);
    if (!c) return '';
    if (!c.parentId || seen.has(c.parentId)) return c.name;
    seen.add(id);
    const parent = path(c.parentId, seen);
    return parent ? `${parent} / ${c.name}` : c.name;
  };
  return categories.map((c) => ({ value: c.id, label: path(c.id) })).sort((a, b) => a.label.localeCompare(b.label));
}

// ---- Status timeline (PLAN 4.8) ----

const MAIN_PATH = ['Submitted', 'Analysed', 'Matched', 'Offered', 'Accepted', 'Scheduled', 'Active', 'Completed'] as const;
type MainStep = (typeof MAIN_PATH)[number];

/** Which main-path step a timeline or request status corresponds to (null for side states). */
function mainStepOf(status: string): MainStep | null {
  if (status === 'Proposed' || status === 'Waitlisted') return 'Matched';
  return (MAIN_PATH as readonly string[]).includes(status) ? (status as MainStep) : null;
}

const SIDE_DESCRIPTION: Record<string, string> = {
  Unmatched: 'No suitable class yet. Your request stays open and we will match you when one appears.',
  Declined: 'You declined the offer.',
  Expired: 'The offer expired before it was accepted.',
  Cancelled: 'This request was cancelled.',
};

/**
 * Builds the learner-facing timeline from the request status and its statusTimeline:
 * Submitted → Analysed → Matched / Waitlisted → Offered → Accepted → Scheduled → Active → Completed,
 * with Unmatched, Declined, Expired and Cancelled shown as stopped steps.
 */
export function buildTimeline(status: string, entries: readonly TimelineEntry[] = []): TimelineStep[] {
  const lastAt = new Map<MainStep, TimelineEntry>();
  let reached = 0;
  for (const e of entries) {
    const step = mainStepOf(e.status);
    if (!step) continue;
    lastAt.set(step, e);
    reached = Math.max(reached, MAIN_PATH.indexOf(step));
  }
  const waitlisted = status === 'Waitlisted' || (status !== 'Matched' && entries.some((e) => e.status === 'Waitlisted') && !entries.some((e) => e.status === 'Proposed'));
  const label = (s: MainStep) => (s === 'Matched' && waitlisted ? 'Waitlisted' : s);
  const dated = (s: MainStep) => {
    const e = lastAt.get(s);
    return e ? formatDate(e.at) : undefined;
  };
  const note = (s: MainStep) => lastAt.get(s)?.note || undefined;

  const currentStep = mainStepOf(status);
  if (currentStep) {
    const idx = MAIN_PATH.indexOf(currentStep);
    return MAIN_PATH.map((s, i) => ({
      label: label(s),
      state: i < idx || (i === idx && s === 'Completed') ? 'done' : i === idx ? 'current' : 'pending',
      date: i <= idx ? dated(s) : undefined,
      description: i === idx && s === 'Matched' && waitlisted ? 'You are on the waitlist for a class.' : note(s),
    }));
  }

  // Side state: done up to the furthest step reached, then the stopped step.
  const sideEntry = [...entries].reverse().find((e) => e.status === status);
  const doneUpTo = status === 'Unmatched' ? Math.max(reached, 1) : reached;
  const steps: TimelineStep[] = MAIN_PATH.slice(0, doneUpTo + 1).map((s) => ({ label: label(s), state: 'done', date: dated(s), description: note(s) }));
  steps.push({
    label: status,
    state: 'failed',
    date: sideEntry ? formatDate(sideEntry.at) : undefined,
    description: sideEntry?.note || SIDE_DESCRIPTION[status],
  });
  if (status === 'Unmatched') {
    for (const s of MAIN_PATH.slice(doneUpTo + 1)) steps.push({ label: label(s), state: 'pending' });
  }
  return steps;
}
