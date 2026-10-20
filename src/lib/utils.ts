import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Token-aware class merge. Plain tailwind-merge reads design-system text styles such as
 * `text-control` as colours and drops them next to `text-ink`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['figure-xl', 'figure-lg', 'title', 'heading', 'body', 'body-sm', 'delta', 'label', 'nav', 'control', 'data'],
      spacing: ['control-sm', 'control-md', 'control-lg', 'sidebar', 'header'],
      radius: ['pill'],
      shadow: ['primary', 'gloss'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "HH:mm" to minutes from midnight. */
export function toMinutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Minutes from midnight to "HH:mm". */
export function toHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function isDefined<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}
