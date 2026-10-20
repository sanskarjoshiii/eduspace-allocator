'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiSend } from '@/lib/api';
import { formatDate, formatDateTime, formatInr, formatKm, formatNumber } from '@/lib/format';
import type { LearnerDashboard as LearnerDashboardData, LearnerRequestCard, PendingOfferDto } from '@/server/dto/analytics';
import {
  Alert, Button, EmptyState, Panel, PanelGrid, StatCard, StatusBadge, Tag, Timeline, errorMessage, useConfirm, useToast,
  type TimelineStep,
} from '@/components/ui';
import { IconLink, ListRow, dashboardKeys } from './dashboard-parts';

const FAILED = new Set(['Unmatched', 'Declined', 'Expired', 'Cancelled']);

/** Maps the API timeline (done / current / upcoming) onto the Timeline component; off-path statuses show as failed. */
function toSteps(r: LearnerRequestCard): TimelineStep[] {
  return r.timeline.map((s) => {
    if (s.state === 'current') {
      if (FAILED.has(r.status)) return { label: r.status, state: 'failed', description: r.note ?? undefined };
      if (r.status === 'Waitlisted') return { label: 'Waitlisted', state: 'current', description: r.note ?? undefined };
      return { label: s.label, state: 'current' };
    }
    return { label: s.label, state: s.state === 'done' ? 'done' : 'pending' };
  });
}

function useOfferAnswer() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: 'accept' | 'decline' }) => apiSend('POST', `/api/enrollments/${id}/${answer}`),
    onSuccess: (_d, v) => {
      toast.success(v.answer === 'accept' ? 'Offer accepted' : 'Offer declined');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 410) toast.error('This offer expired');
      else toast.error(errorMessage(err, 'Your answer did not go through. Try again in a moment.'));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
      void qc.invalidateQueries({ queryKey: ['allocations'] });
    },
  });
}

function OfferRow({ offer, answer, busy }: { offer: PendingOfferDto; answer: ReturnType<typeof useOfferAnswer>; busy: boolean }) {
  const { confirm, dialog } = useConfirm();
  const [now] = useState(() => Date.now());
  const expired = offer.expiresAt ? new Date(offer.expiresAt).getTime() < now : false;
  const onDecline = async () => {
    const ok = await confirm({
      title: 'Decline Offer?',
      description: 'Your seat goes to the next learner on the waitlist. You can submit a new request later.',
      confirmLabel: 'Decline Offer',
      tone: 'danger',
    });
    if (ok) answer.mutate({ id: offer.enrollmentId, answer: 'decline' });
  };
  return (
    <ListRow className="items-start">
      {dialog}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-body font-medium text-ink">{offer.offeringTitle}</span>
        <span className="text-body-sm text-ink-muted">
          {[offer.spaceName, offer.areaName].filter(Boolean).join(', ') || 'Space to be confirmed'}
        </span>
        <span className="font-mono text-data text-ink-muted">
          {[offer.session, offer.distanceKm !== null ? formatKm(offer.distanceKm) : null].filter(Boolean).join(' · ')}
        </span>
        {offer.expiresAt ? (
          <span className={expired ? 'text-body-sm text-danger-ink' : 'text-body-sm text-ink-muted'}>
            {expired ? 'Expired ' : 'Answer by '}
            <span className="font-mono text-data">{formatDateTime(offer.expiresAt)}</span>
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onDecline}>
          Decline
        </Button>
        <Button
          size="sm"
          icon="check"
          disabled={busy}
          loading={answer.isPending && answer.variables?.id === offer.enrollmentId && answer.variables.answer === 'accept'}
          onClick={() => answer.mutate({ id: offer.enrollmentId, answer: 'accept' })}
        >
          Accept Offer
        </Button>
      </div>
    </ListRow>
  );
}

/** Learner dashboard widgets (README 17). */
export function LearnerDashboard({ data }: { data: LearnerDashboardData }) {
  const answer = useOfferAnswer();

  return (
    <>
      {data.pendingOffers.length ? (
        <div className="border-b border-border px-4 py-3 lg:px-6">
          <Alert tone="warning" title={`${formatNumber(data.pendingOffers.length)} ${data.pendingOffers.length === 1 ? 'offer is' : 'offers are'} waiting for your answer`}>
            Offers expire. Accept or decline before the time shown.
          </Alert>
        </div>
      ) : null}
      <PanelGrid columns={3}>
        <Panel>
          <StatCard label="My Requests" icon="inbox" value={formatNumber(data.requests.length)} action={<IconLink href="/requests" label="Open my requests" />} footnote="Your latest learning requests." />
        </Panel>
        <Panel>
          <StatCard label="Pending Offers" icon="ticket" value={formatNumber(data.pendingOffers.length)} action={<IconLink href="/offers" label="Open offers" />} footnote="Seats held for you right now." />
        </Panel>
        <Panel>
          <StatCard
            label="Nearby Offers"
            icon="map"
            value={formatNumber(data.nearbyOffers)}
            action={<IconLink href="/map" label="Open the map" />}
            footnote={<>Classes near you on the <Link className="text-accent-ink underline underline-offset-2" href="/map">map</Link>.</>}
          />
        </Panel>
      </PanelGrid>

      <PanelGrid columns={2}>
        <Panel title="Pending Offers" description="Accept to keep your seat, or decline to pass it on.">
          {data.pendingOffers.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {data.pendingOffers.map((o) => (
                <OfferRow key={o.enrollmentId} offer={o} answer={answer} busy={answer.isPending} />
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" icon="ticket" description="No offers waiting. We will notify you when a class has a seat for you." />
          )}
        </Panel>

        <Panel title="Recommended Courses" description="Classes that fit your requests and area." actions={<Button size="sm" href="/discover">Discover Courses</Button>}>
          {data.recommended.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {data.recommended.slice(0, 3).map((c) => (
                <ListRow key={c.offeringId} className="items-start">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-medium text-ink">{c.title}</span>
                      <Tag>{c.categoryName}</Tag>
                    </div>
                    <span className="text-body-sm text-ink-muted">
                      {c.providerName}
                      {c.spaceName ? ` · ${c.spaceName}` : ''}
                      {c.areaName ? `, ${c.areaName}` : ''}
                    </span>
                    <span className="font-mono text-data text-ink-muted">
                      {[c.session, c.distanceKm !== null ? formatKm(c.distanceKm) : null, `${formatNumber(c.seatsLeft)} seats left`, c.feePerMonth !== null ? `${formatInr(c.feePerMonth)} / month` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {c.reasons.length ? (
                      <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-body-sm text-ink-muted">
                        {c.reasons.slice(0, 3).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </ListRow>
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" icon="compass" description="No recommendations yet. Submit a request so we know what you want to learn." />
          )}
        </Panel>

        <Panel title="My Requests" description="Where each request is on its way to a class." className="lg:col-span-2">
          {data.requests.length ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {data.requests.map((r) => (
                <article key={r.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4">
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col">
                      <Link className="text-body font-medium text-ink underline-offset-2 hover:underline" href={`/requests/${r.id}`}>
                        {r.categoryName || 'Learning request'}
                      </Link>
                      <span className="text-body-sm text-ink-muted">
                        {r.areaName} · <span className="font-mono text-data">{formatDate(r.createdAt)}</span>
                      </span>
                    </div>
                    <StatusBadge status={r.status} />
                  </header>
                  <Timeline label={`Status of your ${r.categoryName} request`} steps={toSteps(r)} />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="inbox"
              description="No requests yet. Tell us what you want to learn and when you are free."
              action={<Button href="/requests/new" icon="plus">New Request</Button>}
            />
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}
