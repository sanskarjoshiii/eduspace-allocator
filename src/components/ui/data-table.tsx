'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useDebouncedValue } from '@/hooks/use-debounce';
import { cn } from './cn';
import { EmptyState, ErrorState } from './feedback';
import { Icon } from './icon';
import { SearchField } from './inputs';
import { Pagination, pageCount } from './pagination';
import { Skeleton } from './skeleton';

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  key: string;
  direction: SortDirection;
}
type SortPrimitive = string | number | boolean | Date | null | undefined;

export interface DataTableColumn<T> {
  /** Unique key; also the default accessor `row[key]` for cell, sort and search. */
  key: string;
  header: ReactNode;
  cell?: (row: T, index: number) => ReactNode;
  /** `end` for every number. */
  align?: 'start' | 'end' | 'center';
  sortable?: boolean;
  /** Client-mode sort accessor (defaults to row[key]). */
  sortValue?: (row: T) => SortPrimitive;
  /** Client-mode search text (defaults to row[key] when it is a string or number). */
  searchValue?: (row: T) => string;
  /** CSS width, e.g. "120px" or "20%". */
  width?: string;
  /** Hide the column on small screens. */
  hideBelow?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Controlled server mode: the parent fetches the page with apiGet and passes the state here. */
export interface DataTableServerState {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /** Called with the debounced search text (300 ms). */
  onSearch?: (query: string) => void;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  /** Stable key per row. */
  rowKey: (row: T) => string;
  /** Screen-reader caption, e.g. "Spaces". */
  caption: string;
  /** Shows a SearchField above the table. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Filters and actions to the right of the search box. */
  toolbar?: ReactNode;
  /** Client-mode page size; 0 turns pagination off. Default 10. */
  pageSize?: number;
  initialSort?: SortState;
  server?: DataTableServerState;
  loading?: boolean;
  skeletonRows?: number;
  error?: unknown;
  onRetry?: () => void;
  /** Shown when there are no rows (an EmptyState). */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Makes rows navigate on click / Enter. */
  rowHref?: (row: T) => string | undefined;
  /** Noun for the pagination text, e.g. "spaces". */
  itemLabel?: string;
  className?: string;
}

const HIDE: Record<NonNullable<DataTableColumn<unknown>['hideBelow']>, string> = {
  sm: 'max-sm:hidden',
  md: 'max-md:hidden',
  lg: 'max-lg:hidden',
};
const ALIGN = { start: 'text-left', end: 'text-right', center: 'text-center' } as const;

function read<T>(row: T, key: string): unknown {
  return row && typeof row === 'object' ? (row as Record<string, unknown>)[key] : undefined;
}

function compare(a: SortPrimitive, b: SortPrimitive): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (a instanceof Date || b instanceof Date) return new Date(a as Date).getTime() - new Date(b as Date).getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true, sensitivity: 'base' });
}

/**
 * Records table: mono uppercase headers on a sunken row, tabular numerals, row hover.
 * Client mode searches, sorts and paginates `rows`; pass `server` to control it from the API.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  searchable = false,
  searchPlaceholder = 'Search',
  toolbar,
  pageSize = 10,
  initialSort,
  server,
  loading = false,
  skeletonRows = 5,
  error,
  onRetry,
  empty,
  onRowClick,
  rowHref,
  itemLabel,
  className,
}: DataTableProps<T>) {
  const router = useRouter();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [clientSort, setClientSort] = useState<SortState | null>(initialSort ?? null);
  const [clientPage, setClientPage] = useState(1);

  // Server mode: forward the debounced query, skipping the initial empty value.
  const debounced = useDebouncedValue(query, 300);
  const lastSent = useRef('');
  const onSearch = server?.onSearch;
  useEffect(() => {
    if (!onSearch || debounced === lastSent.current) return;
    lastSent.current = debounced;
    onSearch(debounced);
  }, [debounced, onSearch]);

  const sort = server ? (server.sort ?? null) : clientSort;

  const processed = useMemo(() => {
    if (server) return rows;
    let list = [...rows];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((row) =>
        columns.some((c) => {
          const v = c.searchValue ? c.searchValue(row) : read(row, c.key);
          return (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(q);
        }),
      );
    }
    if (clientSort) {
      const col = columns.find((c) => c.key === clientSort.key);
      if (col) {
        const get = col.sortValue ?? ((r: T) => read(r, col.key) as SortPrimitive);
        list.sort((a, b) => compare(get(a), get(b)) * (clientSort.direction === 'asc' ? 1 : -1));
      }
    }
    return list;
  }, [server, rows, query, clientSort, columns]);

  const clientPages = pageSize > 0 ? pageCount(processed.length, pageSize) : 1;
  const page = server ? server.page : Math.min(clientPage, clientPages);
  const visible = server || pageSize <= 0 ? processed : processed.slice((page - 1) * pageSize, page * pageSize);
  const total = server ? server.total : processed.length;
  const effectivePageSize = server ? server.pageSize : pageSize;

  const toggleSort = (key: string) => {
    const next: SortState | null =
      sort?.key !== key ? { key, direction: 'asc' } : sort.direction === 'asc' ? { key, direction: 'desc' } : null;
    if (server) server.onSortChange?.(next);
    else {
      setClientSort(next);
      setClientPage(1);
    }
  };

  const activate = (row: T) => {
    if (onRowClick) onRowClick(row);
    const href = rowHref?.(row);
    if (href) router.push(href);
  };
  const interactive = Boolean(onRowClick || rowHref);

  const showToolbar = searchable || toolbar;
  const isEmpty = !loading && !error && visible.length === 0;

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {showToolbar ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {searchable ? (
            <SearchField
              id={searchId}
              placeholder={searchPlaceholder}
              label={searchPlaceholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setClientPage(1);
              }}
              className="w-full sm:max-w-72"
            />
          ) : (
            <span />
          )}
          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      <div className="min-w-0 overflow-x-auto rounded-lg border border-border bg-surface" aria-busy={loading || undefined}>
        <table className="w-full border-collapse font-sans text-body text-ink">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      'border-b border-border bg-surface-sunken px-4 py-2.5 font-mono text-label whitespace-nowrap text-ink-muted uppercase',
                      ALIGN[c.align ?? 'start'],
                      c.hideBelow && HIDE[c.hideBelow],
                    )}
                  >
                    {c.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          'inline-flex cursor-pointer items-center gap-1 rounded-xs uppercase hover:text-ink',
                          c.align === 'end' && 'flex-row-reverse',
                          active && 'text-ink',
                        )}
                      >
                        {c.header}
                        <Icon name={active ? (sort.direction === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down'} size={12} className={active ? '' : 'opacity-60'} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={`sk-${i}`}>
                    {columns.map((c) => (
                      <td key={c.key} className={cn('border-b border-border px-4 py-3', c.hideBelow && HIDE[c.hideBelow])}>
                        <Skeleton className={cn('h-4', c.align === 'end' ? 'ml-auto w-12' : 'w-3/4')} />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {!loading && error ? (
              <tr>
                <td colSpan={columns.length}>
                  <ErrorState error={error} onRetry={onRetry} size="compact" />
                </td>
              </tr>
            ) : null}
            {isEmpty ? (
              <tr>
                <td colSpan={columns.length}>
                  {query ? (
                    <EmptyState icon="search" description={`No results for “${query}”. Try a different search.`} size="compact" />
                  ) : (
                    (empty ?? <EmptyState description="Nothing to show yet." size="compact" />)
                  )}
                </td>
              </tr>
            ) : null}
            {!loading && !error
              ? visible.map((row, i) => (
                  <tr
                    key={rowKey(row)}
                    onClick={interactive ? () => activate(row) : undefined}
                    onKeyDown={
                      interactive
                        ? (e: KeyboardEvent<HTMLTableRowElement>) => {
                            if (e.key === 'Enter' && e.target === e.currentTarget) activate(row);
                          }
                        : undefined
                    }
                    tabIndex={interactive ? 0 : undefined}
                    className={cn(
                      'transition-colors duration-120 ease-out hover:bg-surface-sunken [&:last-child>td]:border-b-0',
                      interactive && 'cursor-pointer focus-visible:outline-offset-[-2px]',
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn('border-b border-border px-4 py-3 align-middle tabular-nums', ALIGN[c.align ?? 'start'], c.hideBelow && HIDE[c.hideBelow], c.className)}
                      >
                        {c.cell ? c.cell(row, i) : (read(row, c.key) as ReactNode)}
                      </td>
                    ))}
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>

      {effectivePageSize > 0 && total > effectivePageSize && !error ? (
        <Pagination
          page={page}
          pageSize={effectivePageSize}
          total={total}
          itemLabel={itemLabel}
          onPageChange={(p) => (server ? server.onPageChange(p) : setClientPage(p))}
        />
      ) : null}
    </div>
  );
}
