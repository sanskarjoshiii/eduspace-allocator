// Display formatting per the design system: en-IN grouping, ₹, km to one decimal,
// 24-hour times with an en dash, dates as "31 Dec 2026".

import { DAY_SHORT } from './domain';
import { toHHmm } from './utils';

const intl = new Intl.NumberFormat('en-IN');
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
});

export const formatNumber = (n: number): string => intl.format(n);
export const formatInr = (n: number): string => inr.format(n);
export const formatKm = (km: number): string => `${km.toFixed(1)} km`;
export const formatPercent = (ratio: number, digits = 1): string => `${(ratio * 100).toFixed(digits)}%`;
export const formatScore = (score: number): string => score.toFixed(2);

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return dateFmt.format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return dateTimeFmt.format(new Date(d));
}

/** "Sat 10:00–13:00" from a window with times as "HH:mm" or minutes. */
export function formatWindow(w: { dayOfWeek: number; startTime?: string; endTime?: string; start?: number; end?: number }): string {
  const start = w.startTime ?? (w.start !== undefined ? toHHmm(w.start) : '');
  const end = w.endTime ?? (w.end !== undefined ? toHHmm(w.end) : '');
  return `${DAY_SHORT[w.dayOfWeek] ?? '?'} ${start}–${end}`;
}
