'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'eduspace-theme';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

const getSnapshot = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
/** Server render has no theme; components render the light variant and update after hydration. */
const getServerSnapshot = (): Theme | null => null;

/** Current theme from the `dark` class on <html> (null during server render / hydration). */
export function useThemeValue(): Theme | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Read and change the theme. Writes localStorage 'eduspace-theme' and toggles the `dark` class. */
export function useTheme() {
  const theme = useThemeValue();
  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // storage blocked; the class still applies for this page
    }
  }, []);
  const toggle = useCallback(() => setTheme(getSnapshot() === 'dark' ? 'light' : 'dark'), [setTheme]);
  return { theme, setTheme, toggle };
}
