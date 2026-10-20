'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserChip } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Popover } from '@/components/ui/popover';
import { ROLE_LABEL, type Role } from '@/lib/domain';

export interface ShellUser {
  name: string;
  email: string;
  role: Role;
}

/** Signs out and returns to /login. */
export function signOutToLogin() {
  return signOut({ redirectTo: '/login' });
}

/** Initials chip in the header; opens name, email, role and Sign Out. */
export function UserMenu({ user }: { user: ShellUser }) {
  return (
    <Popover
      label="Account"
      className="w-64"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`Account: ${user.name}`}
          className="inline-flex h-control-md cursor-pointer items-center gap-1 rounded-md px-1.5 transition-colors duration-120 ease-out hover:bg-surface-tint"
        >
          <UserChip name={user.name} compact className="[&>span:last-child]:max-lg:sr-only" />
          <Icon name="chevron-down" size={14} className="text-ink-subtle max-sm:hidden" />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          <div className="flex flex-col gap-1 border-b border-border px-4 py-3">
            <span className="truncate text-body font-medium text-ink">{user.name}</span>
            <span className="truncate text-body-sm text-ink-muted">{user.email}</span>
            <span className="mt-1">
              <Badge tone="neutral">{ROLE_LABEL[user.role]}</Badge>
            </span>
          </div>
          <div className="flex flex-col gap-1 p-2">
            <Link
              href="/profile"
              onClick={close}
              className="flex h-control-md items-center gap-2 rounded-md px-2 font-mono text-control text-ink-muted no-underline hover:bg-surface-tint hover:text-ink"
            >
              <Icon name="user" size={16} />
              Profile
            </Link>
            <Link
              href="/notifications"
              onClick={close}
              className="flex h-control-md items-center gap-2 rounded-md px-2 font-mono text-control text-ink-muted no-underline hover:bg-surface-tint hover:text-ink"
            >
              <Icon name="bell" size={16} />
              Notifications
            </Link>
            <Button variant="ghost" icon="log-out" onClick={() => void signOutToLogin()} className="justify-start px-2">
              Sign Out
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}
