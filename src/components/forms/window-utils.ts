// Pure helpers for weekly windows { dayOfWeek, startTime: "HH:mm", endTime: "HH:mm" }.
import { DAY_SHORT } from '@/lib/domain';

export interface WeeklyWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const label = (w: WeeklyWindow) => `${DAY_SHORT[w.dayOfWeek] ?? '?'} ${w.startTime}–${w.endTime}`;

/**
 * Per-row problems: invalid time, end not after start, or overlap with another window on the
 * same day. Returns a map of row index to message (empty when all rows are valid).
 */
export function findWindowProblems(windows: readonly WeeklyWindow[]): Record<number, string> {
  const problems: Record<number, string> = {};
  windows.forEach((w, i) => {
    if (!HHMM.test(w.startTime) || !HHMM.test(w.endTime)) problems[i] = 'Use 24-hour HH:mm times.';
    else if (toMin(w.endTime) <= toMin(w.startTime)) problems[i] = 'End time must be after start time.';
  });
  // Only rows with valid times take part in the overlap check (both rows of a pair are flagged).
  const invalid = new Set(Object.keys(problems).map(Number));
  for (let i = 0; i < windows.length; i++) {
    if (invalid.has(i)) continue;
    for (let j = 0; j < windows.length; j++) {
      if (i === j || invalid.has(j)) continue;
      const a = windows[i]!;
      const b = windows[j]!;
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (toMin(a.startTime) < toMin(b.endTime) && toMin(b.startTime) < toMin(a.endTime)) {
        problems[i] = `Overlaps with ${label(b)}.`;
        break;
      }
    }
  }
  return problems;
}

/** "HH:mm" options from 00:00 to 23:59 every `step` minutes (23:59 is appended as the day end). */
export function timeOptions(step = 30): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  if (out[out.length - 1] !== '23:59') out.push('23:59');
  return out;
}

/** Sorts by day then start time (for display and stable saves). */
export function sortWindows<T extends WeeklyWindow>(windows: readonly T[]): T[] {
  return [...windows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMin(a.startTime) - toMin(b.startTime));
}
