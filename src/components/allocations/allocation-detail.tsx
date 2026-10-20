'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '@/lib/api';
import { DAY_SHORT, type Role } from '@/lib/domain';
import { formatDate, formatDateTime, formatKm, formatNumber, formatScore } from '@/lib/format';
import type { LearnerView } from '@/server/dto/privacy';
import {
  Alert, Badge, Button, EmptyState, ErrorState, KeyValueList, PageHeader, Panel, PanelGrid, Progress, Skeleton,
  SkeletonText, StatCard, StatusBadge, Timeline, UserChip, useConfirm, type TimelineStep,
} from '@/components/ui';
import { ExplainPanel } from './explain-panel';
import { OverrideDialog } from './override-dialog';
import {
  allocationKeys, useAllocationAction, type AllocationDetailDto, type LearnerAllocationDto,
} from './allocation-hooks';

type DetailResponse = AllocationDetailDto | LearnerAllocationDto;
const isStaffView = (d: DetailResponse): d is AllocationDetailDto => 'breakdown' in d;

function windowsLabel(ws: { dayOfWeek: number; startTime: string; endTime: string }[]): string {
  if (!ws.length) return 'No windows given';
  return ws.map((w) => `${DAY_SHORT[w.dayOfWeek] ?? '?'} ${w.startTime}–${w.endTime}`).join(', ');
}

/** Renders exactly what the DTO gives for this viewer; never more. */
function LearnerEntry({ l }: { l: LearnerView }) {
  switch (l.visibility) {
    case 'full':
      return (
        <div className="flex flex-col gap-1">
          <UserChip name={l.name} meta={`${l.areaName} · ${l.ageBand}`} />
          <span className="text-body-sm text-ink-muted">
            {[l.contactPhone, l.contactEmail].filter(Boolean).join(' · ') || 'No contact details'}
          </span>
          {l.accessibilityNeeds.length ? <span className="text-body-sm text-ink-muted">Needs: {l.accessibilityNeeds.join(', ')}</span> : null}
        </div>
      );
    case 'provider-accepted':
      return (
        <div className="flex flex-col gap-1">
          <UserChip name={l.name} meta={`${l.areaName} (area centre) · ${l.ageBand}`} />
          <span className="text-body-sm text-ink-muted">
            {[l.contactPhone, l.contactEmail].filter(Boolean).join(' · ') || 'No contact details'}
          </span>
          {l.accessibilityNeeds.length ? <span className="text-body-sm text-ink-muted">Needs: {l.accessibilityNeeds.join(', ')}</span> : null}
        </div>
      );
    case 'roster':
      return <UserChip name={l.name} />;
    case 'cohort':
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-body text-ink">Learner from {l.areaName}</span>
          <span className="font-mono text-data text-ink-muted">{windowsLabel(l.windows)}</span>
        </div>
      );
    default:
      return null;
  }
}

function historySteps(a: AllocationDetailDto): TimelineStep[] {
  const failed = new Set(['Rejected', 'Cancelled', 'NeedsReallocation', 'Superseded']);
  return a.statusHistory.map((h, i) => {
    const last = i === a.statusHistory.length - 1;
    return {
      label: h.label,
      date: formatDateTime(h.at),
      description: h.note || undefined,
      state: last ? (failed.has(h.status) ? 'failed' : 'current') : 'done',
    };
  });
}

function LoadingView() {
  return (
    <>
      <PageHeader title="Allocation" description="Loading the allocation." />
      <PanelGrid columns={3}>
        {[0, 1, 2].map((i) => (
          <Panel key={i}>
            <StatCard label="Loading" loading />
          </Panel>
        ))}
      </PanelGrid>
      <PanelGrid columns={2}>
        {[0, 1].map((i) => (
          <Panel key={i}>
            <Skeleton className="mb-3 h-5 w-40" />
            <SkeletonText lines={5} />
          </Panel>
        ))}
      </PanelGrid>
    </>
  );
}

function LearnerDetail({ a }: { a: LearnerAllocationDto }) {
  return (
    <>
      <PageHeader title={a.courseTitle} description={`${a.spaceName}, ${a.areaName}.`} meta={<StatusBadge status={a.status} />} />
      <Panel title="Your Place" description="Where and when the class meets, and the state of your place.">
        <KeyValueList
          items={[
            { label: 'Space', value: `${a.spaceName}, ${a.areaName}` },
            { label: 'Session', value: a.sessionLabel, mono: true },
            { label: 'Class', value: <StatusBadge status={a.status} /> },
            { label: 'Your place', value: a.myEnrollment ? <StatusBadge status={a.myEnrollment.status} /> : '—' },
            ...(a.myEnrollment?.offerExpiresAt ? [{ label: 'Offer open until', value: formatDateTime(a.myEnrollment.offerExpiresAt), mono: true }] : []),
            ...(a.myEnrollment?.waitlistRank ? [{ label: 'Waitlist rank', value: formatNumber(a.myEnrollment.waitlistRank), mono: true }] : []),
          ]}
        />
        {a.myEnrollment?.status === 'Offered' ? (
          <div className="mt-4">
            <Button href="/offers" icon="ticket">
              Answer Offer
            </Button>
          </div>
        ) : null}
      </Panel>
    </>
  );
}

/** Allocation detail with the Explain panel, seats, cohort, schedule, history and role actions. */
export function AllocationDetail({ id, role }: { id: string; role: Role }) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const action = useAllocationAction();
  const { confirm, dialog } = useConfirm();
  const query = useQuery({
    queryKey: allocationKeys.detail(id),
    queryFn: () => apiGet<DetailResponse>(`/api/allocations/${id}`),
  });

  if (query.isPending) return <LoadingView />;
  if (query.isError || !query.data) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <PageHeader title="Allocation" />
        <Panel>
          {missing ? (
            <EmptyState icon="list-checks" description="This allocation does not exist or is not shared with you." action={<Button href="/allocations">Back to Allocations</Button>} />
          ) : (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          )}
        </Panel>
      </>
    );
  }
  if (!isStaffView(query.data)) return <LearnerDetail a={query.data} />;

  const a = query.data;
  const busy = action.isPending;
  const canApprove = a.actions.approve && role !== 'Administrator';
  const canReject = a.actions.reject && role !== 'Administrator';
  const canConfirm = a.actions.confirm && role !== 'Administrator';

  const onReject = async () => {
    const ok = await confirm({
      title: 'Decline Allocation?',
      description: 'The class will not use this space. Smart Allocation will look for another space on its next run.',
      confirmLabel: 'Decline',
      tone: 'danger',
    });
    if (ok) action.mutate({ id: a.id, action: 'reject' });
  };

  const replacedHref = a.replacesAllocationId ? `/allocations/${a.replacesAllocationId}` : null;
  const replacementLinkable = role === 'Administrator' || role === 'CourseProvider';
  const seats = a.seats;
  const scheduleSorted = [...a.schedules].sort((x, y) => x.date.localeCompare(y.date) || x.startTime.localeCompare(y.startTime));

  return (
    <>
      {dialog}
      {role === 'Administrator' && a.actions.override ? <OverrideDialog allocation={a} open={overrideOpen} onClose={() => setOverrideOpen(false)} /> : null}
      <PageHeader
        title={a.courseTitle}
        description={`${a.spaceName}, ${a.areaName}. ${a.categoryName}.`}
        meta={
          <>
            <StatusBadge status={a.status} />
            {a.replacesAllocationId ? <Badge tone="warning">Reallocation proposal</Badge> : null}
            <span className="font-mono text-data text-ink-muted">{a.sessionLabel}</span>
          </>
        }
        actions={
          <>
            {canReject ? (
              <Button variant="danger" icon="x" disabled={busy} onClick={onReject}>
                Decline
              </Button>
            ) : null}
            {role === 'Administrator' && a.actions.override ? (
              <Button icon="settings-2" onClick={() => setOverrideOpen(true)}>
                Override
              </Button>
            ) : null}
            {canApprove ? (
              <Button variant="primary" icon="check" loading={busy && action.variables?.action === 'approve'} disabled={busy} onClick={() => action.mutate({ id: a.id, action: 'approve' })}>
                Approve
              </Button>
            ) : null}
            {canConfirm ? (
              <Button variant="primary" icon="check" loading={busy && action.variables?.action === 'confirm'} disabled={busy} onClick={() => action.mutate({ id: a.id, action: 'confirm' })}>
                Confirm
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 empty:hidden lg:px-6">
        {replacedHref ? (
          <Alert
            tone="warning"
            title="Reallocation proposal"
            action={
              <Button size="sm" href={replacedHref}>
                View Original
              </Button>
            }
          >
            This proposal replaces a class that can no longer run in its space. Nothing moves until this space approves and the provider confirms.
          </Alert>
        ) : null}
        {role === 'CourseProvider' && a.status === 'Proposed' ? (
          <Alert tone="info" title="Waiting for the space">
            {a.spaceGiverName || 'The space giver'} has not approved this yet. You can confirm once they do.
          </Alert>
        ) : null}
        {role === 'SpaceGiver' && a.status === 'ApprovedBySpace' ? (
          <Alert tone="info" title="Waiting for the provider">
            You approved this. {a.providerName || 'The provider'} confirms next, then learners receive offers.
          </Alert>
        ) : null}
        {a.status === 'NeedsReallocation' ? (
          <Alert tone="danger" title="Needs reallocation">
            A facility issue means this class no longer fits its space. A replacement proposal is on its way.
          </Alert>
        ) : null}
        {a.replacements.length ? (
          <Alert tone="info" title="Replacement proposals">
            <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
              {a.replacements.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  {replacementLinkable ? (
                    <Link className="text-accent-ink underline underline-offset-2" href={`/allocations/${r.id}`}>
                      {r.spaceName}
                    </Link>
                  ) : (
                    <span>{r.spaceName}</span>
                  )}
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {a.overrideNote ? (
          <Alert tone="neutral" title="Administrator override">
            {a.overrideNote}
          </Alert>
        ) : null}
      </div>

      <PanelGrid columns={3}>
        <Panel>
          <StatCard label="Compatibility Score" value={formatScore(a.score)} footnote="How well this space fits the class, from 0.00 to 1.00." />
        </Panel>
        <Panel>
          <StatCard
            label="Distance"
            value={a.distanceKm === null ? '—' : formatKm(a.distanceKm)}
            footnote="From the learners' area centre to the space."
          />
        </Panel>
        <Panel>
          <StatCard label="Seats Held" value={`${formatNumber(seats.taken)} / ${formatNumber(seats.batchSize)}`} footnote={<><strong>{formatNumber(seats.waitlisted)}</strong> learners on the waitlist.</>} />
        </Panel>
      </PanelGrid>

      <ExplainPanel allocation={a} />

      <PanelGrid columns={2}>
        <Panel title="Details" description="The offering and the space it was placed in.">
          <KeyValueList
            items={[
              { label: 'Offering', value: a.offering.title },
              { label: 'Provider', value: a.providerName || '—' },
              { label: 'Audience', value: a.offering.audience },
              { label: 'Starts', value: formatDate(a.offering.startDate), mono: true },
              { label: 'Duration', value: `${formatNumber(a.offering.durationWeeks)} weeks`, mono: true },
              { label: 'Session', value: a.sessionLabel, mono: true },
              { label: 'Space', value: a.space.name },
              { label: 'Address', value: a.space.address || a.space.areaName },
              { label: 'Space giver', value: a.spaceGiverName || '—' },
              { label: 'Seat capacity', value: formatNumber(a.space.seatCapacity), mono: true },
              { label: 'Approval', value: a.space.approvalMode === 'auto' ? 'Automatic' : 'Manual' },
            ]}
          />
        </Panel>
        <Panel title="Seats" description="Places held for this class against its batch size.">
          <div className="flex flex-col gap-5">
            <Progress
              value={seats.taken}
              max={Math.max(1, seats.batchSize)}
              label="Seats held"
              startLabel={`${formatNumber(seats.taken)} seats held`}
              endLabel={`${formatNumber(seats.batchSize)} seats`}
            />
            <Progress
              value={seats.accepted}
              max={Math.max(1, seats.batchSize)}
              tone="success"
              label="Seats accepted"
              startLabel={`${formatNumber(seats.accepted)} accepted`}
              endLabel={`${formatNumber(seats.batchSize)} seats`}
            />
            <KeyValueList
              columns={2}
              items={[
                { label: 'Proposed', value: formatNumber(seats.proposed), mono: true },
                { label: 'Offered', value: formatNumber(seats.offered), mono: true },
                { label: 'Accepted', value: formatNumber(seats.accepted), mono: true },
                { label: 'Waitlisted', value: formatNumber(seats.waitlisted), mono: true },
              ]}
            />
          </div>
        </Panel>
        <Panel title="Cohort" description="Learners in this class, shown as far as your role may see them.">
          {a.cohort ? (
            <div className="flex flex-col gap-4">
              <KeyValueList
                items={[
                  { label: 'Headcount', value: formatNumber(a.cohort.headcount), mono: true },
                  ...a.cohort.byArea.map((b) => ({ label: `${b.areaName} (area)`, value: formatNumber(b.count), mono: true })),
                ]}
              />
              {a.cohort.learners.length ? (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {a.cohort.learners.map((l) => (
                    <li key={l.requestId} className="border-b border-dashed border-border-strong pb-3 last:border-b-0 last:pb-0">
                      <LearnerEntry l={l} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-body-sm text-ink-muted">Names appear here once learners accept their offers.</p>
              )}
            </div>
          ) : (
            <EmptyState size="compact" icon="users" description="No cohort details for this allocation." />
          )}
        </Panel>
        <Panel title="Schedule" description="Weekly sessions generated once a learner accepts.">
          {scheduleSorted.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {scheduleSorted.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-border-strong py-2.5 last:border-b-0">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-mono text-data text-ink">
                      {formatDate(`${s.date}T00:00:00Z`)} · {s.startTime}–{s.endTime}
                    </span>
                    {s.spaceId !== a.spaceId ? <span className="text-body-sm text-ink-muted">{s.spaceName}</span> : null}
                    {s.note ? <span className="text-body-sm text-ink-muted">{s.note}</span> : null}
                  </div>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" icon="calendar" description="No sessions yet. They are created when the first learner accepts." />
          )}
        </Panel>
        <Panel title="Status History" description="Every change to this allocation, newest last." className="lg:col-span-2">
          {a.statusHistory.length ? (
            <Timeline label="Allocation status history" steps={historySteps(a)} />
          ) : (
            <EmptyState size="compact" icon="clock" description="No status changes recorded yet." />
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}
