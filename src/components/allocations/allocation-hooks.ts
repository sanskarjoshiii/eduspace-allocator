'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiSend } from '@/lib/api';
import type { AllocationDetailDto, AllocationListItemDto, LearnerAllocationDto } from '@/server/dto/allocation';
import { errorMessage, useToast } from '@/components/ui';

export type { AllocationDetailDto, AllocationListItemDto, LearnerAllocationDto };

/** `GET /api/allocations` returns `{ items, meta }` (not the flat Paged shape). */
export interface AllocationListResponse<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; pages: number };
}

export const allocationKeys = {
  all: ['allocations'] as const,
  list: (filters: Record<string, unknown>) => ['allocations', 'list', filters] as const,
  detail: (id: string) => ['allocations', 'detail', id] as const,
};

export type AllocationAction = 'approve' | 'reject' | 'confirm';

const DONE: Record<AllocationAction, string> = {
  approve: 'Allocation approved',
  reject: 'Allocation declined',
  confirm: 'Allocation confirmed',
};

/** Approve / reject (space giver) and confirm (provider). Invalidates dashboards and allocation queries. */
export function useAllocationAction() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: AllocationAction; note?: string }) =>
      apiSend<AllocationDetailDto>('POST', `/api/allocations/${id}/${action}`, note ? { note } : {}),
    onSuccess: (data, vars) => {
      toast.success(DONE[vars.action]);
      qc.setQueryData(allocationKeys.detail(vars.id), data);
      void qc.invalidateQueries({ queryKey: allocationKeys.all });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err, vars) => {
      if (err instanceof ApiError && err.status === 409 && vars.action === 'confirm') {
        toast.error(err.message || 'The space has not approved this yet.');
      } else {
        toast.error(errorMessage(err, 'That did not go through. Try again in a moment.'));
      }
    },
  });
}

/** Human label for an engine criterion or constraint key: "travelDistance" → "Travel distance". */
export function humanize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
