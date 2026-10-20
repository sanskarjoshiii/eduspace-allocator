'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface LookupOption {
  id: string;
  name: string;
  /** Categories only: the parent category, which drives similarity. */
  parentId?: string | null;
}

export interface Lookups {
  facilityTypes: LookupOption[];
  categories: LookupOption[];
  areas: LookupOption[];
}

export const lookupKeys = { all: ['lookups'] as const };

/** GET /api/lookups → { facilityTypes, categories, areas }. Cached for 10 minutes. */
export function useLookups() {
  return useQuery({
    queryKey: lookupKeys.all,
    queryFn: async () => {
      const d = await apiGet<Partial<Lookups>>('/api/lookups');
      return { facilityTypes: d.facilityTypes ?? [], categories: d.categories ?? [], areas: d.areas ?? [] } satisfies Lookups;
    },
    staleTime: 10 * 60_000,
  });
}
