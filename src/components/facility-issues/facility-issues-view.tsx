'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { FACILITY_ISSUE_STATUSES, type Role } from '@/lib/domain';
import { formatDateTime, formatNumber } from '@/lib/format';
import {
  Button, ConfirmDialog, DataTable, EmptyState, PageHeader, Panel, PanelGrid, Select, StatCard, StatusBadge,
  type DataTableColumn,
} from '@/components/ui';
import { facilityIssueKeys, useResolveIssue, type FacilityIssueDto } from './facility-issue-hooks';
import { ReportIssueDialog } from './report-issue-dialog';

/** Facility issue "Open" takes the warning tone (STATUS_TONE maps Open to info for offerings). */
export function IssueStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} tone={status === 'Open' ? 'warning' : undefined} />;
}

/** Facility issues: Space Giver sees their own and reports new ones; Administrator sees all with filters. */
export function FacilityIssuesView({ role }: { role: Role }) {
  const [status, setStatus] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [resolving, setResolving] = useState<FacilityIssueDto | null>(null);
  const resolve = useResolveIssue();
  const canReport = role === 'SpaceGiver' || role === 'Administrator';

  const query = useQuery({
    queryKey: facilityIssueKeys.list({ status }),
    queryFn: () => apiGet<FacilityIssueDto[]>('/api/facility-issues', { status }),
  });
  const all = query.data ?? [];
  const rows = spaceId ? all.filter((i) => i.spaceId === spaceId) : all;
  const spaceOptions = [...new Map(all.map((i) => [i.spaceId, i.spaceName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
  const open = all.filter((i) => i.status === 'Open');
  const affected = open.reduce((n, i) => n + i.affectedAllocationIds.length, 0);
  const proposals = open.reduce((n, i) => n + i.replacementAllocationIds.length, 0);

  const columns: DataTableColumn<FacilityIssueDto>[] = [
    {
      key: 'facilityName', header: 'Facility', sortable: true,
      cell: (r) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-ink">{r.facilityName}</span>
          <span className="truncate text-body-sm text-ink-muted">{r.spaceName}</span>
        </div>
      ),
      searchValue: (r) => `${r.facilityName} ${r.spaceName} ${r.description}`,
    },
    { key: 'affectedQuantity', header: 'Units', align: 'end', sortable: true, hideBelow: 'sm', cell: (r) => formatNumber(r.affectedQuantity) },
    { key: 'affected', header: 'Allocations Affected', align: 'end', hideBelow: 'md', sortValue: (r) => r.affectedAllocationIds.length, sortable: true, cell: (r) => formatNumber(r.affectedAllocationIds.length) },
    { key: 'reportedByName', header: 'Reported By', hideBelow: 'lg' },
    { key: 'createdAt', header: 'Reported', sortable: true, hideBelow: 'sm', cell: (r) => <span className="font-mono text-data">{formatDateTime(r.createdAt)}</span> },
    { key: 'status', header: 'Status', cell: (r) => <IssueStatusBadge status={r.status} /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'end',
      cell: (r) =>
        r.status === 'Open' && canReport ? (
          <Button
            size="sm"
            icon="check"
            onClick={(e) => {
              e.stopPropagation();
              setResolving(r);
            }}
          >
            Resolve
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Facility Issues"
        description={role === 'Administrator' ? 'Broken facilities across all spaces and the classes they affect.' : 'Report broken facilities in your spaces and track the classes they affect.'}
        actions={
          canReport ? (
            <Button variant="primary" icon="plus" onClick={() => setReportOpen(true)}>
              Report Issue
            </Button>
          ) : undefined
        }
      />
      <PanelGrid columns={3}>
        <Panel>
          <StatCard label="Open Issues" icon="triangle-alert" value={formatNumber(open.length)} loading={query.isPending} footnote="Facilities waiting to be fixed." />
        </Panel>
        <Panel>
          <StatCard label="Allocations Affected" icon="list-checks" value={formatNumber(affected)} loading={query.isPending} footnote="Classes that no longer fit while issues stay open." />
        </Panel>
        <Panel>
          <StatCard label="Reallocation Proposals" icon="shuffle" value={formatNumber(proposals)} loading={query.isPending} footnote="Replacement spaces proposed for affected classes." />
        </Panel>
      </PanelGrid>
      <Panel title="Issues" description="Open an issue to see the classes it affected and their replacement proposals.">
        <DataTable
          caption="Facility issues"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowHref={(r) => `/facility-issues/${r.id}`}
          searchable
          searchPlaceholder="Search issues"
          itemLabel="issues"
          initialSort={{ key: 'createdAt', direction: 'desc' }}
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
                options={FACILITY_ISSUE_STATUSES.map((s) => ({ value: s, label: s }))}
                onChange={(e) => setStatus(e.target.value)}
              />
              {role === 'Administrator' && spaceOptions.length > 1 ? (
                <Select aria-label="Filter by space" size="sm" value={spaceId} placeholder="All spaces" options={spaceOptions} onChange={(e) => setSpaceId(e.target.value)} />
              ) : null}
            </div>
          }
          empty={
            <EmptyState
              icon="circle-check"
              size="compact"
              description={status || spaceId ? 'No issues match these filters.' : 'No facility issues reported. Everything is working.'}
            />
          }
        />
      </Panel>
      {canReport ? <ReportIssueDialog open={reportOpen} onClose={() => setReportOpen(false)} role={role} /> : null}
      <ConfirmDialog
        open={resolving !== null}
        onClose={() => setResolving(null)}
        onConfirm={async () => {
          if (resolving) await resolve.mutateAsync(resolving.id);
        }}
        title="Resolve Issue?"
        description={
          resolving
            ? `${resolving.facilityName} at ${resolving.spaceName} works again. Affected classes that fit again return to their space and unconfirmed replacement proposals are withdrawn.`
            : undefined
        }
        confirmLabel="Resolve Issue"
      />
    </>
  );
}
