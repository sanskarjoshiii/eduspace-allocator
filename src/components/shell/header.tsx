'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { IconButton } from '@/components/ui/button';
import { Breadcrumb } from '@/components/ui/navigation';
import { deriveBreadcrumbs, type MenuItem } from './nav-utils';
import { NotificationBell } from './notification-bell';
import { ThemeToggle } from './theme-toggle';
import { UserMenu, type ShellUser } from './user-menu';

export interface HeaderProps {
  menu: MenuItem[];
  user: ShellUser;
  onOpenMenu: () => void;
  menuOpen: boolean;
}

/** h-header bar: breadcrumb (from path + menu labels) left; bell, theme and account right. */
export function Header({ menu, user, onOpenMenu, menuOpen }: HeaderProps) {
  const pathname = usePathname();
  const crumbs = useMemo(() => deriveBreadcrumbs(pathname, menu), [pathname, menu]);
  return (
    <header className="sticky top-0 z-30 flex h-header flex-none items-center gap-2 border-b border-border bg-surface px-4 lg:static lg:rounded-t-2xl lg:px-6">
      <IconButton icon="menu" label="Open Navigation" size="md" onClick={onOpenMenu} aria-expanded={menuOpen} className="-ml-1.5 lg:hidden" />
      <Breadcrumb items={crumbs} className="min-w-0 flex-1" />
      <div className="flex flex-none items-center gap-1">
        <NotificationBell />
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
