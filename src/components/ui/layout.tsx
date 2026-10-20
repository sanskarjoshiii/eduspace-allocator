import type { ReactNode } from 'react';
import { cn } from './cn';
import { renderIcon, type IconInput } from './icon';

export interface PageHeaderProps {
  /** Page title in Title Case; matches the last breadcrumb and nav label. */
  title: ReactNode;
  /** One sentence in sentence case. */
  description?: ReactNode;
  /** Right side: filters, secondary buttons and the one primary button (last). */
  actions?: ReactNode;
  /** Small row under the description (badges, dates). */
  meta?: ReactNode;
  className?: string;
}

/** Title row under the breadcrumb bar. */
export function PageHeader({ title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between lg:px-6 lg:py-5', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="m-0 text-title text-ink">{title}</h1>
        {description ? <p className="m-0 text-body-sm text-ink-muted">{description}</p> : null}
        {meta ? <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:flex-none sm:justify-end">{actions}</div> : null}
    </div>
  );
}

export interface PanelProps {
  /** Panel heading in Title Case. */
  title?: ReactNode;
  /** One body-sm line saying what the panel is for. */
  description?: ReactNode;
  icon?: IconInput;
  actions?: ReactNode;
  /** Remove the body padding (e.g. a flush table or map). */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  id?: string;
  children?: ReactNode;
}

/** A section of a page: heading + one-line description + actions + body. Tile them in PanelGrid. */
export function Panel({ title, description, icon, actions, flush, className, bodyClassName, id, children }: PanelProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('flex min-w-0 flex-col bg-surface', className)}>
      {title || actions ? (
        <header className="flex flex-col gap-2 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between lg:px-6 lg:pt-5">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? (
              <h2 id={headingId} className="m-0 flex items-center gap-2 text-heading text-ink">
                {renderIcon(icon, 16)}
                {title}
              </h2>
            ) : null}
            {description ? <p className="m-0 text-body-sm text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 sm:flex-none">{actions}</div> : null}
        </header>
      ) : null}
      <div
        className={cn(
          'min-w-0 flex-1',
          flush ? (title || actions ? 'pt-4' : '') : title || actions ? 'px-4 pt-4 pb-4 lg:px-6 lg:pb-6' : 'p-4 lg:p-6',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export interface PanelGridProps {
  /** Columns at the lg breakpoint (always one column on phones). */
  columns?: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
}

/** Tiles panels edge to edge with 1px hairlines between them. Use `lg:col-span-2` on a Panel to widen it. */
export function PanelGrid({ columns = 2, className, children }: PanelGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-px border-b border-border bg-border',
        columns === 2 && 'lg:grid-cols-2',
        columns === 3 && 'md:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Set times, dates, distances and scores in mono. */
  mono?: boolean;
}

export interface KeyValueListProps {
  items: KeyValueItem[];
  columns?: 1 | 2;
  className?: string;
}

/** Definition list of facts; rows divide with dashed rules. */
export function KeyValueList({ items, columns = 1, className }: KeyValueListProps) {
  return (
    <dl className={cn('m-0 grid grid-cols-1 gap-x-8', columns === 2 && 'sm:grid-cols-2', className)}>
      {items.map((it, i) => (
        <div key={i} className="flex min-w-0 items-baseline justify-between gap-4 border-b border-dashed border-border-strong py-2.5 last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
          <dt className="flex-none text-body-sm text-ink-muted">{it.label}</dt>
          <dd className={cn('m-0 min-w-0 text-right text-body break-words text-ink', it.mono && 'font-mono text-data tabular-nums')}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface DividerProps {
  variant?: 'solid' | 'dashed';
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/** Hairline rule. Dashed (border-strong) separates a figure from its meta line. */
export function Divider({ variant = 'solid', orientation = 'horizontal', className }: DividerProps) {
  return (
    <hr
      aria-orientation={orientation}
      className={cn(
        'm-0 border-0',
        orientation === 'horizontal' ? 'w-full border-t' : 'h-auto self-stretch border-l',
        variant === 'dashed' ? 'border-dashed border-border-strong' : 'border-border',
        className,
      )}
    />
  );
}
