'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** True when the media query matches; `false` during server render. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop shell breakpoint (Tailwind `lg`, 1024px). */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
