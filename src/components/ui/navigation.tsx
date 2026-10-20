import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { renderIcon, type IconInput } from './icon';

export interface NavItemProps extends Omit<ComponentProps<typeof Link>, 'href' | 'children'> {
  href: string;
  label: string;
  icon?: IconInput;
  /** Current page: raised tint and aria-current="page". */
  active?: boolean;
  /** Nested item: no icon, hangs off a dashed guide. */
  sub?: boolean;
  /** Count of things that need action. */
  badge?: ReactNode;
}

/** One entry in the left rail, mono, 18px icon. */
export function NavItem({ href, label, icon, active = false, sub = false, badge, className, ...rest }: NavItemProps) {
  return (
    <Link
      href={href}
      {...rest}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-md px-2.5 font-mono text-nav text-ink-muted no-underline transition-colors duration-120 ease-out',
        'hover:bg-surface-tint hover:text-ink',
        sub ? 'h-8.5 pl-9.5 before:absolute before:top-0 before:bottom-0 before:left-4.75 before:border-l before:border-dashed before:border-border-strong' : 'h-9',
        active && 'bg-surface-tint font-medium text-ink shadow-xs',
        className,
      )}
    >
      {sub ? null : renderIcon(icon, 18)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge !== undefined && badge !== null ? (
        <span className="h-5 min-w-5 rounded-pill bg-accent-tint px-1.5 text-center text-delta leading-5 text-accent-ink tabular-nums">{badge}</span>
      ) : null}
    </Link>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  /** Strings or { label, href }; the last item is the current page. */
  items: Array<string | Crumb>;
  icon?: IconInput;
  className?: string;
}

/** Where the page sits: mono, slash separators, at the left of the header bar. */
export function Breadcrumb({ items, icon, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex min-w-0 items-center gap-2.5 font-mono text-data text-ink-subtle', className)}>
      {renderIcon(icon, 16)}
      <ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-2 p-0">
        {items.map((it, i) => {
          const item = typeof it === 'string' ? { label: it } : it;
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className={cn('inline-flex min-w-0 items-center gap-2', !last && 'max-sm:hidden')}>
              {i > 0 ? (
                <span aria-hidden className="max-sm:hidden">
                  /
                </span>
              ) : null}
              {last || !item.href ? (
                <span aria-current={last ? 'page' : undefined} className={cn('truncate', last && 'text-ink')}>
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="truncate rounded-xs text-ink-subtle no-underline hover:text-ink">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
