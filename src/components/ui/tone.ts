import type { Tone } from '@/lib/domain';

export type { Tone };
/** Fill tones for bars, dots and chart marks. `neutral` is the remainder colour. */
export type FillTone = 'accent' | 'success' | 'info' | 'sky' | 'warning' | 'danger' | 'neutral';

/** Tint ground + ink text: badges, tags, marks. */
export const TONE_TINT: Record<Tone, string> = {
  neutral: 'bg-surface-tint text-ink-muted',
  accent: 'bg-accent-tint text-accent-ink',
  success: 'bg-success-tint text-success-ink',
  info: 'bg-info-tint text-info-ink',
  warning: 'bg-warning-tint text-warning-ink',
  danger: 'bg-danger-tint text-danger-ink',
};

/** Solid fills: bars, dots and chart marks. */
export const TONE_FILL: Record<FillTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  info: 'bg-info',
  sky: 'bg-sky',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-border-strong',
};

/** Chart and segment series order from the design system. */
export const SERIES_ORDER: readonly FillTone[] = ['accent', 'success', 'info', 'sky', 'neutral'];
