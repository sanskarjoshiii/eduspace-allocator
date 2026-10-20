'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { useMenu } from '@/hooks/use-me';
import { Header } from './header';
import type { MenuItem } from './nav-utils';
import { Sidebar } from './sidebar';
import type { ShellUser } from './user-menu';

export interface AppShellProps {
  user: ShellUser;
  /** Server-computed menu for the role; the client refreshes it from GET /api/me/menu. */
  initialMenu: MenuItem[];
  children: ReactNode;
}

/** Shows "You do not have access to that page." when the proxy redirected with ?denied=1. */
function DeniedNotice() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { error } = useToast();
  const shown = useRef(false);
  const denied = params.get('denied') === '1';
  useEffect(() => {
    if (!denied || shown.current) return;
    shown.current = true;
    error('You do not have access to that page.');
    const rest = new URLSearchParams(params.toString());
    rest.delete('denied');
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [denied, error, params, pathname, router]);
  return null;
}

/** Role-aware shell: rail (drawer below 1024px), header bar and the main panel. */
export function AppShell({ user, initialMenu, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuQuery = useMenu(initialMenu);
  const menu = menuQuery.data ?? initialMenu;

  return (
    <ToastProvider>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 font-mono text-control text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to Content
      </a>
      <div className="min-h-dvh bg-surface-sunken lg:flex">
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-sidebar lg:flex-none lg:flex-col">
          <Suspense fallback={null}>
            <Sidebar menu={menu} loading={menuQuery.isPending} user={user} shortcut />
          </Suspense>
        </aside>

        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Navigation" className="lg:hidden">
          <Suspense fallback={null}>
            <Sidebar
              menu={menu}
              user={user}
              onNavigate={() => setDrawerOpen(false)}
              headerAction={<IconButton icon="x" label="Close Navigation" onClick={() => setDrawerOpen(false)} />}
            />
          </Suspense>
        </Drawer>

        <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
          <div className="flex min-h-dvh min-w-0 flex-1 flex-col bg-surface lg:min-h-[calc(100dvh-1rem)] lg:rounded-2xl lg:border lg:border-border">
            <Header menu={menu} user={user} onOpenMenu={() => setDrawerOpen(true)} menuOpen={drawerOpen} />
            <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col focus-visible:outline-none">
              {children}
            </main>
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        <DeniedNotice />
      </Suspense>
    </ToastProvider>
  );
}
