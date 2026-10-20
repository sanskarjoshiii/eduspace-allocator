'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '@/lib/api';
import type { Role } from '@/lib/domain';
import { formatDateTime, formatNumber } from '@/lib/format';
import {
  Button, ConfirmDialog, EmptyState, ErrorState, KeyValueList, PageHeader, Panel, PanelGrid, Skeleton, SkeletonText,
  StatusBadge,
} from '@/components/ui';
import { allocationKeys, type AllocationDetailDto } from '@/components/allocations/allocation-hooks';
import { facilityIssueKeys, useResolveIssue, type FacilityIssueDto } from './facility-issue-hooks';
import { IssueStatusBadge } from './facility-issues-view';

function AffectedRow({ id, state, role }: { id: string; state: { data?: AllocationDetailDto; isPending: boolean; error: unknown }; role: Role }) {
  if (state.isPending) {
    return (
      <li className="border-b border-dashed border-border-strong py-3 last:border-b-0">
        <Skeleton className="h-4 w-56" />
      </li>
    );
  }
  const a = state.data;
  if (!a) {
    return (
      <li className="flex items-center justify-between gap-3 border-b border-dashed border-border-strong py-3 last:border-b-0">
        <span className="text-body-sm text-ink-muted">This allocation is not shared with you.</span>
      </li>
    );
  }
  const linkReplacement = role === 'Administrator' || role === 'CourseProvider';
  return (
    <li className="flex flex-col gap-2 border-b border-dashed border-border-strong py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <Link className="text-body text-ink underline-offset-2 hover:underline" href={`/allocations/${id}`}>
            {a.courseTitle}
          </Link>
          <span className="font-mono text-data text-ink-muted">{a.sessionLabel}</span>
        </div>
        <StatusBadge status={a.status} />
      </div>
      {a.replacements.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 pl-3">
          {a.replacements.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-body-sm">
              <span className="text-ink-muted">Proposed move to</span>
              {linkReplacement ? (
                <Link className="text-accent-ink underline underline-offset-2" href={`/allocations/${r.id}`}>
                  {r.spaceName}
                </Link>
              ) : (
                <span className="text-ink">{r.spaceName}</span>
              )}
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      ) : a.status === 'NeedsReallocation' ? (
        <p className="m-0 pl-3 text-body-sm text-ink-muted">No replacement space found yet.</p>
      ) : null}
    </li>
  );
}

/** Facility issue detail with its affected allocations and their replacement proposals. */
export function FacilityIssueDetail({ id, role }: { id: string; role: Role }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const resolve = useResolveIssue();
  const query = useQuery({
    queryKey: facilityIssueKeys.detail(id),
    queryFn: () => apiGet<FacilityIssueDto>(`/api/facility-issues/${id}`),
  });
  const issue = query.data;
  const affected = useQueries({
    queries: (issue?.affectedAllocationIds ?? []).map((aid) => ({
      queryKey: allocationKeys.detail(aid),
      queryFn: () => apiGet<AllocationDetailDto>(`/api/allocations/${aid}`),
      retry: false,
    })),
  });

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Facility Issue" description="Loading the issue." />
        <Panel>
          <Skeleton className="mb-3 h-5 w-48" />
          <SkeletonText lines={5} />
        </Panel>
      </>
    );
  }
  if (query.isError || !issue) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <PageHeader title="Facility Issue" />
        <Panel>
          {missing ? (
            <EmptyState icon="triangle-alert" description="This issue does not exist or is not shared with you." action={<Button href="/facility-issues">Back to Facility Issues</Button>} />
          ) : (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          )}
        </Panel>
      </>
    );
  }

  const canResolve = issue.status === 'Open' && (role === 'SpaceGiver' || role === 'Administrator');

  return (
    <>
      <PageHeader
        title={`${issue.facilityName} Issue`}
        description={`${issue.spaceName}. Reported by ${issue.reportedByName || 'a space giver'}.`}
        meta={
          <>
            <IssueStatusBadge status={issue.status} />
            <span className="font-mono text-data text-ink-muted">{formatDateTime(issue.createdAt)}</span>
          </>
        }
        actions={
          canResolve ? (
            <Button variant="primary" icon="check" onClick={() => setConfirmOpen(true)}>
              Resolve Issue
            </Button>
          ) : undefined
        }
      />
      <PanelGrid columns={2}>
        <Panel title="Details" description="What stopped working and when.">
          <KeyValueList
            items={[
              { label: 'Space', value: issue.spaceName },
              { label: 'Facility', value: issue.facilityName },
              { label: 'Units affected', value: formatNumber(issue.affectedQuantity), mono: true },
              { label: 'Status', value: <IssueStatusBadge status={issue.status} /> },
              { label: 'Reported', value: formatDateTime(issue.createdAt), mono: true },
              { label: 'Resolved', value: formatDateTime(issue.resolvedAt), mono: true },
              {
                label: 'Evidence',
                value: issue.evidenceUrl ? (
                  <a className="text-accent-ink underline underline-offset-2" href={issue.evidenceUrl} target="_blank" rel="noopener noreferrer">
                    Open link
                  </a>
                ) : (
                  '—'
                ),
              },
            ]}
          />
          {issue.description ? <p className="m-0 mt-4 text-body whitespace-pre-line text-ink">{issue.description}</p> : null}
        </Panel>
        <Panel title="Affected Allocations" description="Classes that no longer fit and the replacement spaces proposed for them.">
          {issue.affectedAllocationIds.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {issue.affectedAllocationIds.map((aid, i) => {
                const q = affected[i];
                return (
                  <AffectedRow
                    key={aid}
                    id={aid}
                    role={role}
                    state={{ data: q?.data, isPending: q?.isPending ?? true, error: q?.error }}
                  />
                );
              })}
            </ul>
          ) : (
            <EmptyState size="compact" icon="circle-check" description="No classes were affected. Every booking still fits." />
          )}
        </Panel>
      </PanelGrid>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          await resolve.mutateAsync(issue.id);
        }}
        title="Resolve Issue?"
        description="The facility works again. Affected classes that fit again return to their space and unconfirmed replacement proposals are withdrawn."
        confirmLabel="Resolve Issue"
      />
    </>
  );
}
