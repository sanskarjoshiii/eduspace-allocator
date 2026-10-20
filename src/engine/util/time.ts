import type { TimeWindow } from '../types';

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Length of a window in minutes (0 when malformed). */
export function windowMinutes(w: TimeWindow): number {
  return Math.max(0, w.end - w.start);
}

/** Overlapping minutes of two windows (0 on different days). */
export function overlapMinutes(a: TimeWindow, b: TimeWindow): number {
  if (a.dayOfWeek !== b.dayOfWeek) return 0;
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Minutes of `w` covered by the union of `windows` (overlapping windows are not double counted). */
export function overlapWithUnion(w: TimeWindow, windows: readonly TimeWindow[]): number {
  const parts: [number, number][] = [];
  for (const x of windows) {
    if (x.dayOfWeek !== w.dayOfWeek) continue;
    const s = Math.max(x.start, w.start);
    const e = Math.min(x.end, w.end);
    if (e > s) parts.push([s, e]);
  }
  parts.sort((p, q) => p[0] - q[0]);
  let total = 0;
  let curS = -1;
  let curE = -1;
  for (const [s, e] of parts) {
    if (s > curE) {
      total += curE - curS;
      curS = s;
      curE = e;
    } else if (e > curE) {
      curE = e;
    }
  }
  return total + (curE - curS);
}

/** `base` minus every same-day window in `cuts`, as disjoint sub-windows in time order. */
export function subtractWindows(base: TimeWindow, cuts: readonly TimeWindow[]): TimeWindow[] {
  let free: [number, number][] = [[base.start, base.end]];
  for (const c of cuts) {
    if (c.dayOfWeek !== base.dayOfWeek) continue;
    const next: [number, number][] = [];
    for (const [s, e] of free) {
      if (c.end <= s || c.start >= e) {
        next.push([s, e]);
        continue;
      }
      if (c.start > s) next.push([s, c.start]);
      if (c.end < e) next.push([c.end, e]);
    }
    free = next;
  }
  return free.filter(([s, e]) => e > s).map(([start, end]) => ({ dayOfWeek: base.dayOfWeek, start, end }));
}

/** True when `inner` lies completely inside `outer`. */
export function containsWindow(outer: TimeWindow, inner: TimeWindow): boolean {
  return outer.dayOfWeek === inner.dayOfWeek && inner.start >= outer.start && inner.end <= outer.end;
}

export function sameWindow(a: TimeWindow, b: TimeWindow): boolean {
  return a.dayOfWeek === b.dayOfWeek && a.start === b.start && a.end === b.end;
}

/** "HH:MM", 24-hour. */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "Sat 10:00–13:00" (en dash). */
export function formatWindow(w: TimeWindow): string {
  return `${DAY_SHORT[w.dayOfWeek]} ${formatClock(w.start)}–${formatClock(w.end)}`;
}
