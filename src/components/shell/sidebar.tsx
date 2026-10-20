'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { SearchField } from '@/components/ui/inputs';
import { NavItem } from '@/components/ui/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { ROLE_LABEL } from '@/lib/domain';
import { filterMenu, findActiveHref, type MenuItem } from './nav-utils';
import { signOutToLogin, type ShellUser } from './user-menu';

export interface SidebarProps {
  menu: MenuItem[];
  loading?: boolean;
  user: ShellUser;
  /** Called after a nav link is followed (closes the mobile drawer). */
  onNavigate?: () => void;
  /** Register the Ctrl/⌘ K shortcut to focus the menu search. */
  shortcut?: boolean;
  /** Extra control in the wordmark row (e.g. the drawer close button). */
  headerAction?: React.ReactNode;
}

/** Left rail: wordmark, menu search, role menu from GET /api/me/menu, Live status and Sign Out. */
export function Sidebar({ menu, loading, user, onNavigate, shortcut = false, headerAction }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');

  const items = useMemo(() => filterMenu(menu, q), [menu, q]);
  const active = useMemo(() => findActiveHref(menu, pathname, searchParams.toString()), [menu, pathname, searchParams]);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  const follow = () => {
    setQ('');
    onNavigate?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 bg-surface-sunken px-3 pt-4 pb-3">
      <div className="flex h-8 items-center justify-between gap-2 px-2.5">
        <Link href="/dashboard" onClick={onNavigate} className="rounded-xs font-sans text-title text-ink no-underline">
          EduSpace
        </Link>
        {headerAction}
      </div>

      <SearchField
        ref={inputRef}
        id={searchId}
        placeholder="Search menu"
        label="Search menu"
        shortcut={shortcut ? '⌘K' : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQ('');
        }}
      />

      <nav aria-label="Main" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {loading && menu.length === 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {Array.from({ length: 7 }, (_, i) => (
              <li key={i}>
                <Skeleton className="h-9 w-full" />
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <EmptyState icon="search" description={q ? `No menu item matches “${q}”.` : 'No pages are available for your role.'} size="compact" />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {items.map((item) => (
              <li key={item.href}>
                <NavItem href={item.href} label={item.label} icon={item.icon} active={active === item.href} onClick={follow} />
                {item.children && item.children.length > 0 ? (
                  <ul className="m-0 mt-0.5 flex list-none flex-col gap-0.5 p-0">
                    {item.children.map((c) => (
                      <li key={c.href}>
                        <NavItem href={c.href} label={c.label} sub active={active === c.href} onClick={follow} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="flex flex-col gap-2 border-t border-border px-1 pt-3">
        <div className="flex items-center justify-between gap-2 px-1.5">
          <span className="inline-flex items-center gap-2 font-mono text-delta text-ink-muted">
            <span aria-hidden className="size-2 rounded-pill bg-accent" />
            Live
          </span>
          <span className="truncate font-mono text-delta text-ink-subtle">{ROLE_LABEL[user.role]}</span>
        </div>
        <Button variant="ghost" size="sm" icon="log-out" onClick={() => void signOutToLogin()} className="justify-start">
          Sign Out
        </Button>
      </div>
    </div>
  );
}
