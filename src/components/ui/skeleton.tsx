import type { CSSProperties } from 'react';
import { cn } from './cn';

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/** A surface-tint block shaped like the content it stands in for. Never a lone spinner. */
export function Skeleton({ className, style }: SkeletonProps) {
  return <span aria-hidden className={cn('block animate-pulse rounded-md bg-surface-tint', className)} style={style} />;
}

/** A few lines of text placeholder; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </span>
  );
}

/** Screen-reader announcement for a loading region. Pair with skeleton blocks. */
export function LoadingLabel({ children = 'Loading' }: { children?: string }) {
  return (
    <span role="status" className="sr-only">
      {children}
    </span>
  );
}
