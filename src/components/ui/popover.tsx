'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

export interface PopoverProps {
  /** Renders the trigger; spread `props` onto a button. */
  trigger: (props: { 'aria-expanded': boolean; 'aria-controls': string; 'aria-haspopup': 'dialog'; onClick: () => void }, open: boolean) => ReactNode;
  /** Panel content; call `close()` after an action. */
  children: (close: () => void) => ReactNode;
  /** Accessible name of the panel. */
  label: string;
  align?: 'start' | 'end';
  className?: string;
  /** Notified when the panel opens or closes. */
  onOpenChange?: (open: boolean) => void;
}

/** Click-to-open floating panel (menus, notification list). Closes on outside click and Esc. */
export function Popover({ trigger, children, label, align = 'end', className, onOpenChange }: PopoverProps) {
  const [open, setOpenState] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const setOpenRef = useRef(setOpen);
  useEffect(() => {
    setOpenRef.current = setOpen;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenRef.current(false);
        (rootRef.current?.querySelector('[aria-haspopup]') as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      {trigger({ 'aria-expanded': open, 'aria-controls': id, 'aria-haspopup': 'dialog', onClick: () => setOpen(!open) }, open)}
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          className={cn(
            'absolute top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface text-ink shadow-sm',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
