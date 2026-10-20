'use client';

import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';

export interface TooltipProps {
  /** Short text; the trigger must still have its own accessible name. */
  content: ReactNode;
  side?: 'top' | 'bottom';
  /** A single focusable element. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  className?: string;
}

/** Simple accessible tooltip: shows on hover and focus, hides on blur, mouse leave and Esc. */
export function Tooltip({ content, side = 'top', children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = isValidElement(children) ? cloneElement(children, { 'aria-describedby': open ? id : undefined }) : children;
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      {trigger}
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute left-1/2 z-50 w-max max-w-60 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-body-sm text-ink shadow-sm',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
