'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { RUN_STATUSES, RUN_TRIGGERS } from '@/lib/domain';
import { formatDateTime, formatKm, formatNumber, formatPercent, formatScore } from '@/lib/format';
import {
  Alert, Button, DataTable, EmptyState, PageHeader, Panel, Select, StatusBadge,
  type DataTableColumn,
} from '@/components/ui';
import { TRIGGER_LABEL, formatDuration, runKeys, useRetryRun, useTriggerRun, type RunListItemDto, type RunListResponse } from './run-hooks';

const PAGE_SIZE = 20;

/** Smart Allocation run monitor (Administrator). Polls every 10 s while a run is queued or running. */
export function RunMonitor() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [trigger, setTrigger] = useState('');
  const run = useTriggerRun();
  const retry = useRetryRun();

  const query = useQuery({
    queryKey: runKeys.list({ page, status, trigger }),
    queryFn: () => apiGet<RunListResponse>('/api/runs', { page, pageSize: PAGE_SIZE, status, trigger }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === 'Running' || r.status === 'Queued') ? 10_000 : false),
  });
  const items = query.data?.items ?? [];
  const live = items.some((r) => r.status === 'Running' || r.status === 'Queued');

  const columns: DataTableColumn<RunListItemDto>[] = [
    { key: 'ref', header: 'Run', cell: (r) => <span className="font-mono text-data">{r.ref}</span> },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'trigger', header: 'Trigger', hideBelow: 'sm', cell: (r) => TRIGGER_LABEL[r.trigger] ?? r.trigger },
    { key: 'startedAt', header: 'Started', hideBelow: 'md', cell: (r) => <span className="font-mono text-data">{formatDateTime(r.startedAt)}</span> },
    { key: 'durationMs', header: 'Duration', align: 'end', hideBelow: 'lg', cell: (r) => <span className="font-mono text-data">{formatDuration(r.durationMs)}</span> },
    { key: 'coverageRate', header: 'Coverage', align: 'end', cell: (r) => (r.coverageRate === null ? '—' : formatPercent(r.coverageRate)) },
    {
      key: 'optimisationScore', header: 'Optimisation Score', align: 'end', hideBelow: 'md',
      cell: (r) => <span className="font-mono text-data">{r.optimisationScore === null ? '—' : formatScore(r.optimisationScore)}</span>,
    },
    { key: 'avgDistanceKm', header: 'Avg Distance', align: 'end', hideBelow: 'lg', cell: (r) => (r.avgDistanceKm === null ? '—' : <span className="font-mono text-data">{formatKm(r.avgDistanceKm)}</span>) },
    { key: 'allocations', header: 'Allocations', align: 'end', cell: (r) => (r.allocations === null ? '—' : formatNumber(r.allocations)) },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'end',
      cell: (r) =>
        r.status === 'Failed' ? (
          <Button
            size="sm"
            icon="refresh-cw"
            loading={retry.isPending && retry.variables === r.id}
            disabled={retry.isPending || run.isPending}
            onClick={(e) => {
              e.stopPropagation();
              retry.mutate(r.id);
            }}
          >
            Retry
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Smart Allocation"
        description="Every allocation run, its outcome and how it compares with the last ones."
        actions={
          <Button variant="primary" icon="play" loading={run.isPending} disabled={live} onClick={() => run.mutate()}>
            Run Allocation
          </Button>
        }
      />
      {live ? (
        <div className="border-b border-border px-4 py-3 lg:px-6">
          <Alert tone="info" title="A run is in progress">This list refreshes every 10 seconds until it finishes.</Alert>
        </div>
      ) : null}
      {run.isPending ? (
        <div className="border-b border-border px-4 py-3 lg:px-6">
          <Alert tone="info" title="Smart Allocation is running">Matching requests to spaces. This page updates when the run finishes.</Alert>
        </div>
      ) : null}
      <Panel title="Runs" description="Open a run to see its decisions and the comparison with the nearest-space baseline.">
        <DataTable
          caption="Smart Allocation runs"
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          rowHref={(r) => `/runs/${r.id}`}
          itemLabel="runs"
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          toolbar={
            <div className="flex flex-wrap gap-2">
              <Select
                aria-label="Filter by status"
                size="sm"
                value={status}
                placeholder="All statuses"
                options={RUN_STATUSES.map((s) => ({ value: s, label: s }))}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              />
              <Select
                aria-label="Filter by trigger"
                size="sm"
                value={trigger}
                placeholder="All triggers"
                options={RUN_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABEL[t] ?? t }))}
                onChange={(e) => {
                  setTrigger(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          }
          empty={
            <EmptyState
              icon="layers"
              size="compact"
              description={status || trigger ? 'No runs match these filters.' : 'No runs yet. Start one with Run Allocation.'}
            />
          }
          server={{ page, pageSize: PAGE_SIZE, total: query.data?.meta.total ?? 0, onPageChange: setPage }}
        />
      </Panel>
    </>
  );
}
