'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { Role, UserStatus } from '@/lib/domain';
import type { MenuItem } from '@/server/auth/menu';
import { normalizeMenu } from '@/components/shell/nav-utils';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  ownerRefId: string | null;
}

export const meKeys = {
  me: ['me'] as const,
  menu: ['me', 'menu'] as const,
};

/** GET /api/me (accepts `{ data: me }` or `{ data: { user: me } }`). */
export function useMe() {
  return useQuery({
    queryKey: meKeys.me,
    queryFn: async () => {
      const data = await apiGet<Me | { user: Me }>('/api/me');
      return 'user' in data ? data.user : data;
    },
    staleTime: 60_000,
  });
}

/**
 * GET /api/me/menu. The shell passes the server-computed menu as `initialData`, so the rail
 * renders immediately and the endpoint stays the source of truth.
 */
export function useMenu(initialData?: MenuItem[]) {
  return useQuery({
    queryKey: meKeys.menu,
    queryFn: async () => normalizeMenu(await apiGet<unknown>('/api/me/menu')),
    initialData,
    staleTime: 5 * 60_000,
  });
}
