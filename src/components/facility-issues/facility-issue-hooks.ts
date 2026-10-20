'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiSend } from '@/lib/api';
import type { FacilityIssueDto } from '@/server/dto/facility-issue';
import { errorMessage, useToast } from '@/components/ui';

export type { FacilityIssueDto };

export const facilityIssueKeys = {
  all: ['facility-issues'] as const,
  list: (filters: Record<string, unknown>) => ['facility-issues', 'list', filters] as const,
  detail: (id: string) => ['facility-issues', 'detail', id] as const,
};

/** POST /api/facility-issues/:id/resolve. Throws so ConfirmDialog stays open on failure. */
export function useResolveIssue() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: string) => apiSend<FacilityIssueDto>('POST', `/api/facility-issues/${id}/resolve`, {}),
    onSuccess: (issue) => {
      toast.success('Issue resolved');
      qc.setQueryData(facilityIssueKeys.detail(issue.id), issue);
      void qc.invalidateQueries({ queryKey: facilityIssueKeys.all });
      void qc.invalidateQueries({ queryKey: ['allocations'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error(errorMessage(err, 'The issue could not be resolved. Try again in a moment.')),
  });
}
