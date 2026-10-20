'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, type Paged } from '@/lib/api';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  href?: string | null;
  isRead: boolean;
  createdAt: string;
}

/** Bell polling interval (PLAN 5.3: count updates within the polling interval). */
export const NOTIFICATION_POLL_MS = 30_000;

export const notificationKeys = {
  all: ['notifications'] as const,
  unread: ['notifications', 'unread-count'] as const,
  list: (params: { page?: number; pageSize?: number; unread?: boolean } = {}) => ['notifications', 'list', params] as const,
};

/** GET /api/notifications/unread-count, polled every 30 s while the tab is visible. */
export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: async () => (await apiGet<{ count: number }>('/api/notifications/unread-count')).count,
    refetchInterval: NOTIFICATION_POLL_MS,
    refetchIntervalInBackground: false,
    enabled,
  });
}

/** GET /api/notifications?page=&pageSize= (paged). */
export function useNotifications(params: { page?: number; pageSize?: number; unread?: boolean } = {}, enabled = true) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => apiGet<Paged<NotificationItem>>('/api/notifications', params),
    enabled,
  });
}

/** POST /api/notifications/{id}/read. */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<unknown>('POST', `/api/notifications/${encodeURIComponent(id)}/read`),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/** POST /api/notifications/read-all. */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend<unknown>('POST', '/api/notifications/read-all'),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
