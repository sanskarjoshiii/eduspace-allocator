'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Popover } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useState } from 'react';
import { formatDateTime } from '@/lib/format';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
  type NotificationItem,
} from '@/hooks/use-notifications';

const LATEST = { page: 1, pageSize: 5 } as const;

/** Bell with unread count (polled every 30 s) and a dropdown of the latest five notifications. */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const latest = useNotifications(LATEST, open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const count = unread.data ?? 0;

  const openItem = (n: NotificationItem, close: () => void) => {
    if (!n.isRead) markRead.mutate(n.id);
    close();
    if (n.href) router.push(n.href);
  };

  return (
    <Popover
      label="Notifications"
      onOpenChange={setOpen}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
          className="relative inline-grid size-control-md cursor-pointer place-items-center rounded-sm text-ink-muted transition-colors duration-120 ease-out hover:bg-surface-tint hover:text-ink"
        >
          <Icon name="bell" size={18} />
          {count > 0 ? (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 h-4 min-w-4 rounded-pill bg-accent-strong px-1 text-center font-mono text-delta leading-4 font-medium text-on-accent tabular-nums"
            >
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="m-0 text-heading">Notifications</h2>
            <Button variant="ghost" size="sm" onClick={() => markAll.mutate()} disabled={count === 0 || markAll.isPending}>
              Mark All Read
            </Button>
          </div>
          <div className="max-h-[min(24rem,60dvh)] overflow-y-auto">
            {latest.isPending ? (
              <ul className="m-0 flex list-none flex-col gap-3 p-4">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3.5 w-full" />
                  </li>
                ))}
              </ul>
            ) : latest.isError ? (
              <ErrorState error={latest.error} onRetry={() => latest.refetch()} size="compact" />
            ) : latest.data.items.length === 0 ? (
              <EmptyState icon="bell" description="You are all caught up. New offers, approvals and alerts appear here." size="compact" />
            ) : (
              <ul className="m-0 list-none p-0">
                {latest.data.items.map((n) => (
                  <li key={n.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => openItem(n, close)}
                      className="flex w-full cursor-pointer items-start gap-2.5 px-4 py-3 text-left transition-colors duration-120 ease-out hover:bg-surface-sunken focus-visible:outline-offset-[-2px]"
                    >
                      <span aria-hidden className={cn('mt-1.5 size-2 flex-none rounded-pill', n.isRead ? 'bg-transparent' : 'bg-accent')} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn('text-body-sm text-ink', !n.isRead && 'font-medium')}>
                          {n.title}
                          {!n.isRead ? <span className="sr-only"> (unread)</span> : null}
                        </span>
                        <span className="line-clamp-2 text-body-sm text-ink-muted">{n.message}</span>
                        <span className="font-mono text-delta font-normal text-ink-subtle tabular-nums">{formatDateTime(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-border px-4 py-2.5">
            <Link href="/notifications" onClick={close} className="font-mono text-control text-ink-muted no-underline hover:text-ink">
              View All Notifications
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
