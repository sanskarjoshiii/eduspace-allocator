'use client';

import Link from 'next/link';
import { formatDate, formatNumber, formatPercent, formatScore } from '@/lib/format';
import type { SpaceGiverDashboard as SpaceGiverDashboardData, PendingApprovalDto } from '@/server/dto/analytics';
import { Button, EmptyState, Panel, PanelGrid, Progress, StatCard, useConfirm } from '@/components/ui';
import { useAllocationAction } from '@/components/allocations/allocation-hooks';
import { DemandTable, IconLink, ListRow } from './dashboard-parts';

function ApprovalRow({ p, action }: { p: PendingApprovalDto; action: ReturnType<typeof useAllocationAction> }) {
  const { confirm, dialog } = useConfirm();
  const busy = action.isPending;
  const mine = action.variables?.id === p.allocationId;
  const onDecline = async () => {
    const ok = await confirm({
      title: 'Decline Allocation?',
      description: `${p.courseTitle} will not use ${p.spaceName}. Smart Allocation will look for another space.`,
      confirmLabel: 'Decline',
      tone: 'danger',
    });
    if (ok) action.mutate({ id: p.allocationId, action: 'reject' });
  };
  return (
    <ListRow className="items-start">
      {dialog}
      <div className="flex min-w-0 flex-col gap-1">
        <Link className="text-body font-medium text-ink underline-offset-2 hover:underline" href={`/allocations/${p.allocationId}`}>
          {p.courseTitle}
        </Link>
        <span className="text-body-sm text-ink-muted">{p.spaceName}</span>
        <span className="font-mono text-data text-ink-muted">
          {p.session} · {formatNumber(p.headcount)} learners · compatibility score {formatScore(p.score)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" disabled={busy} loading={busy && mine && action.variables?.action === 'reject'} onClick={onDecline}>
          Decline
        </Button>
        <Button
          size="sm"
          icon="check"
          disabled={busy}
          loading={busy && mine && action.variables?.action === 'approve'}
          onClick={() => action.mutate({ id: p.allocationId, action: 'approve' })}
        >
          Approve
        </Button>
      </div>
    </ListRow>
  );
}

/** Space Giver dashboard widgets (README 17). */
export function SpaceGiverDashboard({ data }: { data: SpaceGiverDashboardData }) {
  const action = useAllocationAction();
  const { totals, spaces } = data.utilisation;

  return (
    <>
      <PanelGrid columns={3}>
        <Panel>
          <StatCard
            label="Utilisation"
            icon="chart-column"
            value={formatPercent(totals.utilisation)}
            footnote={<><strong>{formatNumber(Math.round(totals.bookedHours))}</strong> of {formatNumber(Math.round(totals.openHours))} open hours booked each week.</>}
          />
        </Panel>
        <Panel>
          <StatCard label="Unused Hours" icon="clock" value={`${formatNumber(Math.round(data.unusedHours))} h`} footnote="Open hours per week with no class yet." />
        </Panel>
        <Panel>
          <StatCard
            label="Pending Approvals"
            icon="list-checks"
            value={formatNumber(data.pendingApprovals.length)}
            action={<IconLink href="/allocations?status=Proposed" label="Open allocations awaiting approval" />}
            footnote="Classes waiting for your answer."
          />
        </Panel>
      </PanelGrid>

      <PanelGrid columns={2}>
        <Panel title="Pending Approvals" description="Classes Smart Allocation proposed for your spaces, oldest first.">
          {data.pendingApprovals.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {data.pendingApprovals.map((p) => (
                <ApprovalRow key={p.allocationId} p={p} action={action} />
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" icon="circle-check" description="Nothing to approve. New proposals appear here after each run." />
          )}
        </Panel>

        <Panel title="Space Utilisation" description="Booked hours against open hours per space each week." actions={<Button size="sm" href="/spaces">My Spaces</Button>}>
          {spaces.length ? (
            <div className="flex flex-col gap-5">
              {spaces.map((s) => (
                <Progress
                  key={s.spaceId}
                  value={s.bookedHours}
                  max={Math.max(1, s.openHours)}
                  tone={s.isActive ? 'accent' : 'neutral'}
                  label={`${s.spaceName} utilisation`}
                  startLabel={
                    <>
                      <Link className="text-ink underline-offset-2 hover:underline" href={`/spaces/${s.spaceId}`}>
                        {s.spaceName}
                      </Link>
                      {s.isActive ? '' : ' (inactive)'} · {formatNumber(Math.round(s.bookedHours))} h booked
                    </>
                  }
                  endLabel={`${formatNumber(Math.round(s.openHours))} h open`}
                />
              ))}
            </div>
          ) : (
            <EmptyState size="compact" icon="building-2" description="No spaces yet. Add your first space to start receiving classes." />
          )}
        </Panel>

        <Panel title="Upcoming Sessions" description="The next classes in your spaces.">
          {data.upcomingSessions.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {data.upcomingSessions.map((s) => (
                <ListRow key={s.scheduleId}>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body text-ink">{s.courseTitle}</span>
                    <span className="text-body-sm text-ink-muted">{s.spaceName}</span>
                  </div>
                  <span className="font-mono text-data text-ink">
                    {formatDate(s.date)} · {s.startTime}–{s.endTime}
                  </span>
                </ListRow>
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" icon="calendar" description="No sessions coming up yet." />
          )}
        </Panel>

        <Panel title="Open Issues" description="Facility issues in your spaces that are not fixed yet." actions={<Button size="sm" href="/facility-issues">Facility Issues</Button>}>
          {data.openIssues.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {data.openIssues.map((i) => (
                <ListRow key={i.id}>
                  <div className="flex min-w-0 flex-col">
                    <Link className="text-body text-ink underline-offset-2 hover:underline" href={`/facility-issues/${i.id}`}>
                      {i.facilityName} at {i.spaceName}
                    </Link>
                    <span className="text-body-sm text-ink-muted">{formatNumber(i.affectedQuantity)} units not working</span>
                  </div>
                  <span className="font-mono text-data text-ink-muted">{formatDate(i.createdAt)}</span>
                </ListRow>
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" icon="circle-check" description="No open issues. Report one when a facility stops working." />
          )}
        </Panel>

        <Panel
          title="Nearby Demand"
          description="Open requests in areas your spaces can reach, counted per area."
          className="lg:col-span-2"
          flush
          actions={<Button size="sm" href="/demand-insights">Demand Insights</Button>}
        >
          <DemandTable rows={data.nearbyDemand} caption="Nearby demand" empty="No open demand near your spaces right now." />
        </Panel>
      </PanelGrid>
    </>
  );
}
