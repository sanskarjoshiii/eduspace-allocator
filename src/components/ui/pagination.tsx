import { formatNumber } from '@/lib/format';
import { Button } from './button';
import { cn } from './cn';

export interface PaginationProps {
  /** 1-based page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Noun for the range text, e.g. "spaces". */
  itemLabel?: string;
  className?: string;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** "1–10 of 42 spaces" with Previous / Next. */
export function Pagination({ page, pageSize, total, onPageChange, itemLabel, className }: PaginationProps) {
  const pages = pageCount(total, pageSize);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <p className="m-0 font-mono text-data text-ink-muted tabular-nums" aria-live="polite">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
        {itemLabel ? ` ${itemLabel}` : ''}
      </p>
      <div className="flex items-center gap-2">
        <span className="font-mono text-data text-ink-subtle tabular-nums max-sm:sr-only">
          Page {page} of {pages}
        </span>
        <Button size="sm" icon="chevron-left" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          Previous
        </Button>
        <Button size="sm" iconRight="chevron-right" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Next page">
          Next
        </Button>
      </div>
    </nav>
  );
}
