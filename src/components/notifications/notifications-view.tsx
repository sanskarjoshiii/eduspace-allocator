'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge, Button, EmptyState, ErrorState, Icon, PageHeader, Pagination, Panel, Skeleton, TabPanel, Tabs, cn, useToast,
} from '@/components/ui';
import {
  useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useUnreadCount, type NotificationItem,
} from '@/hooks/use-notifications';
import { formatDateTime } from '@/lib/format';

const PAGE_SIZE = 20;
type Filter = 'all' | 'unread';

function Row({ n, onOpen }: { n: NotificationItem; onOpen: (n: NotificationItem) => void }) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(n)}
        className={cn(
          'flex w-full cursor-pointer items-start gap-3 bg-transparent px-4 py-3 text-left transition-colors duration-120 ease-out hover:bg-surface-sunken lg:px-6',
        )}
      >
        <span aria-hidden className={cn('mt-2 size-2 flex-none rounded-pill', n.isRead ? 'bg-transparent' : 'bg-accent')} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn('text-body text-ink', !n.isRead && 'font-medium')}>{n.title}</span>
            {!n.isRead ? <Badge tone="accent">Unread</Badge> : null}
          </span>
          <span className="text-body-sm text-ink-muted">{n.message}</span>
          <span className="font-mono text-data text-ink-subtle tabular-nums">{formatDateTime(n.createdAt)}</span>
        </span>
        {n.href ? <Icon name="chevron-right" size={16} className="mt-1 flex-none text-ink-subtle" /> : null}
      </button>
    </li>
  );
}

/** /notifications: paged list with an Unread filter, mark read on open, Mark All Read. */
export function NotificationsView() {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const query = useNotifications({ page, pageSize: PAGE_SIZE, unread: filter === 'unread' ? true : undefined });
  const unread = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unreadCount = unread.data ?? 0;

  const open = async (n: NotificationItem) => {
    if (!n.isRead) {
      try {
        await markRead.mutateAsync(n.id);
      } catch {
        // Navigation still makes sense; the badge refreshes on the next poll.
      }
    }
    if (n.href) router.push(n.href);
  };

  const readAll = async () => {
    try {
      await markAll.mutateAsync();
      toast.success('All notifications marked read');
    } catch {
      toast.error('Could not mark notifications read. Try again.');
    }
  };

  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates about your requests, offers, classes and spaces."
        actions={
          <Button icon="check" onClick={() => void readAll()} loading={markAll.isPending} disabled={unreadCount === 0}>
            Mark All Read
          </Button>
        }
      />
      <Panel flush>
        <div className="px-4 lg:px-6">
          <Tabs
            id="notifications"
            label="Filter notifications"
            items={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread', count: unreadCount },
            ]}
            value={filter}
            onValueChange={(v) => {
              setFilter(v as Filter);
              setPage(1);
            }}
          />
        </div>
        <TabPanel id="notifications" value={filter} active={filter}>
          {query.isPending ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-4 lg:px-6">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                </li>
              ))}
            </ul>
          ) : query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="bell"
              description={filter === 'unread' ? 'You are all caught up. No unread notifications.' : 'No notifications yet. Updates about your work appear here.'}
              action={filter === 'unread' ? <Button size="sm" onClick={() => setFilter('all')}>Show All</Button> : undefined}
            />
          ) : (
            <>
              <ul className="m-0 list-none border-t border-border p-0">
                {items.map((n) => (
                  <Row key={n.id} n={n} onOpen={(x) => void open(x)} />
                ))}
              </ul>
              <div className="border-t border-border px-4 py-3 lg:px-6">
                <Pagination page={page} pageSize={PAGE_SIZE} total={query.data?.total ?? 0} onPageChange={setPage} itemLabel="notifications" />
              </div>
            </>
          )}
        </TabPanel>
      </Panel>
    </>
  );
}
