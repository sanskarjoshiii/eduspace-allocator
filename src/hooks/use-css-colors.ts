'use client';

import { useMemo } from 'react';
import { useThemeValue } from './use-theme';

/** Token names (CSS variables without the leading --) that charts and maps paint with. */
export const COLOR_TOKENS = [
  'surface', 'surface-sunken', 'surface-tint', 'border', 'border-strong', 'ink', 'ink-muted', 'ink-subtle',
  'accent', 'accent-strong', 'accent-tint', 'accent-ink', 'on-accent',
  'success', 'success-tint', 'success-ink', 'info', 'info-tint', 'info-ink', 'sky',
  'warning', 'warning-tint', 'warning-ink', 'danger', 'danger-tint', 'danger-ink',
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ThemeColors = Record<ColorToken, string>;

/** Fallback used before hydration: CSS var references (fine for HTML styles; SVG/canvas wait for real values). */
const FALLBACK = Object.fromEntries(COLOR_TOKENS.map((t) => [t, `var(--${t})`])) as ThemeColors;

export function readThemeColors(): ThemeColors {
  if (typeof window === 'undefined') return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(COLOR_TOKENS.map((t) => [t, style.getPropertyValue(`--${t}`).trim() || FALLBACK[t]])) as ThemeColors;
}

/**
 * Resolved token colours for libraries that need literal values (Recharts, Leaflet).
 * Re-reads when the theme class changes, so dark mode works. `ready` is false during SSR/hydration.
 */
export function useThemeColors(): { colors: ThemeColors; ready: boolean } {
  const theme = useThemeValue();
  const colors = useMemo(() => (theme ? readThemeColors() : FALLBACK), [theme]);
  return { colors, ready: theme !== null };
}
