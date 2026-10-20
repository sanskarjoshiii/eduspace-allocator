'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiSend } from '@/lib/api';
import type { RunDetailDto, RunListItemDto } from '@/server/dto/run';
import { errorMessage, useToast } from '@/components/ui';

export type { RunDetailDto, RunListItemDto };

export interface RunListResponse {
  items: RunListItemDto[];
  meta: { total: number; page: number; pageSize: number; pages: number };
}

export const runKeys = {
  all: ['runs'] as const,
  list: (filters: Record<string, unknown>) => ['runs', 'list', filters] as const,
  detail: (id: string) => ['runs', 'detail', id] as const,
};

function onRunDone(toast: ReturnType<typeof useToast>, run: RunDetailDto) {
  if (run.status === 'Failed') toast.error('Smart Allocation run failed', { description: run.error || undefined });
  else toast.success('Smart Allocation run completed');
}

/** POST /api/runs. The response returns once the run has finished. 409 while another run holds the lock. */
export function useTriggerRun() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => apiSend<RunDetailDto>('POST', '/api/runs', {}),
    onSuccess: (run) => {
      onRunDone(toast, run);
      qc.setQueryData(runKeys.detail(run.id), run);
      void qc.invalidateQueries({ queryKey: runKeys.all });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['allocations'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) toast.error('A run is already in progress.');
      else toast.error(errorMessage(err, 'The run could not start. Try again in a moment.'));
    },
  });
}

/** POST /api/runs/:id/retry (Failed runs only). */
export function useRetryRun() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: string) => apiSend<RunDetailDto>('POST', `/api/runs/${id}/retry`, {}),
    onSuccess: (run) => {
      onRunDone(toast, run);
      qc.setQueryData(runKeys.detail(run.id), run);
      void qc.invalidateQueries({ queryKey: runKeys.all });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) toast.error('A run is already in progress, or this run can no longer be retried.');
      else toast.error(errorMessage(err, 'The retry could not start. Try again in a moment.'));
    },
  });
}

export const TRIGGER_LABEL: Record<string, string> = {
  event: 'Data change',
  manual: 'Manual',
  nightly: 'Nightly',
  reallocation: 'Reallocation',
};

/** "1.2 s", "850 ms", "2 min 05 s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
}
