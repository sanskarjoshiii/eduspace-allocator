'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem {
  value: string;
  label: string;
  /** Optional count shown after the label. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  /** Shared id prefix; TabPanel must use the same `id`. */
  id: string;
  /** Accessible name of the tab list. */
  label: string;
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export const tabId = (id: string, value: string) => `${id}-tab-${value}`;
export const panelId = (id: string, value: string) => `${id}-panel-${value}`;

/** Accessible tablist (arrow keys, Home/End). Active tab has a 2px accent bar. */
export function Tabs({ id, label, items, value, onValueChange, className }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((t) => !t.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = enabled.findIndex((t) => t.value === value);
    let next: TabItem | undefined;
    if (e.key === 'ArrowRight') next = enabled[(idx + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(idx - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next) {
      e.preventDefault();
      onValueChange(next.value);
      refs.current[next.value]?.focus();
    }
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn('flex gap-1 overflow-x-auto border-b border-border', className)}>
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[t.value] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id, t.value)}
            aria-selected={active}
            aria-controls={panelId(id, t.value)}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onValueChange(t.value)}
            className={cn(
              'relative inline-flex h-control-lg flex-none cursor-pointer items-center gap-1.5 px-3 font-mono text-control whitespace-nowrap transition-colors duration-120 ease-out',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active ? 'text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-pill after:bg-accent' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.count !== undefined ? <span className="rounded-pill bg-surface-tint px-1.5 text-delta leading-5 text-ink-muted tabular-nums">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  id: string;
  value: string;
  /** Currently selected tab value. */
  active: string;
  className?: string;
  children: ReactNode;
}

/** Content for one tab; renders only when selected. */
export function TabPanel({ id, value, active, className, children }: TabPanelProps) {
  if (value !== active) return null;
  return (
    <div role="tabpanel" id={panelId(id, value)} aria-labelledby={tabId(id, value)} tabIndex={0} className={cn('focus-visible:outline-offset-[-2px]', className)}>
      {children}
    </div>
  );
}
