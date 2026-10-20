'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface PublicImpact {
  learnersServed: number;
  learningHours: number;
  spacesUsed: number;
  areasReached: number;
  sessionsScheduled: number;
  partners: number;
}

export const publicImpactKeys = { all: ['public', 'impact'] as const };

/** GET /api/public/impact (no auth). */
export function usePublicImpact() {
  return useQuery({
    queryKey: publicImpactKeys.all,
    queryFn: () => apiGet<PublicImpact>('/api/public/impact'),
    staleTime: 5 * 60_000,
  });
}
