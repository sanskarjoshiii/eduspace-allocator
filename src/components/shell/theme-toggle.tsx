'use client';

import { IconButton } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';

/** Switches light/dark; persists to localStorage 'eduspace-theme'. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <IconButton
      icon={dark ? 'sun' : 'moon'}
      label={dark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
      size="md"
      onClick={toggle}
      className={className}
    />
  );
}
