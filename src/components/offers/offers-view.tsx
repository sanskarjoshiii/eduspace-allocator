'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, ConfirmDialog, EmptyState, ErrorState, KeyValueList, PageHeader, Panel, PanelGrid, ScoreBar, Skeleton,
  StatusBadge, Tag, useToast, type KeyValueItem,
} from '@/components/ui';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { formatDate, formatDateTime, formatInr, formatKm } from '@/lib/format';
import { ordinal, requestKeys, type RecommendationResult } from '@/components/requests/request-utils';
import { RateCourseDialog } from './rate-course-dialog';
import { OFFER_GROUPS, offerKeys, timeLeft, todayIst, type FeedbackList, type MyEnrollmentDto, type ScheduleDto } from './offer-utils';

/** Re-renders every 30 s so countdowns stay current. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

function facts(e: MyEnrollmentDto): KeyValueItem[] {
  const items: KeyValueItem[] = [
    { label: 'Course provider', value: e.providerName || '—' },
    { label: 'Space', value: [e.spaceName, e.areaName].filter(Boolean).join(', ') || '—' },
  ];
  if (e.spaceAddress) items.push({ label: 'Address', value: e.spaceAddress });
  items.push(
    { label: 'Session', value: e.sessionLabel || 'To be confirmed', mono: Boolean(e.sessionLabel) },
    { label: 'Starts', value: formatDate(e.startDate), mono: true },
  );
  if (e.durationWeeks) items.push({ label: 'Duration', value: `${e.durationWeeks} weeks` });
  if (e.feePerMonth != null) items.push({ label: 'Fee', value: `${formatInr(e.feePerMonth)} / month`, mono: true });
  if (e.distanceKm != null) items.push({ label: 'Distance', value: formatKm(e.distanceKm), mono: true });
  return items;
}

interface CardProps {
  enrollment: MyEnrollmentDto;
  now: number;
  primary: boolean;
  sessions: ScheduleDto[];
  rated: number | null;
  ratingLoading: boolean;
  sessionsLoading: boolean;
}

function OfferCard({ enrollment: e, now, primary, sessions, rated, ratingLoading, sessionsLoading }: CardProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const [accepting, setAccepting] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [expiredNow, setExpiredNow] = useState(false);

  const left = timeLeft(e.offerExpiresAt, now);
  const expired = e.status === 'Offered' && (expiredNow || (e.offerExpiresAt !== null && left === null));

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: offerKeys.mine }),
      qc.invalidateQueries({ queryKey: offerKeys.schedules }),
      qc.invalidateQueries({ queryKey: requestKeys.all }),
    ]);

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 410) {
      setExpiredNow(true);
      toast.error('This offer expired');
      void refresh();
      return;
    }
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
  };

  const accept = async () => {
    setAccepting(true);
    try {
      await apiSend('POST', `/api/enrollments/${e.id}/accept`);
      toast.success('Offer accepted');
      await refresh();
    } catch (err) {
      handleError(err);
    } finally {
      setAccepting(false);
    }
  };

  const decline = async () => {
    try {
      await apiSend('POST', `/api/enrollments/${e.id}/decline`);
      toast.success('Offer declined');
      await refresh();
    } catch (err) {
      handleError(err);
      throw err;
    }
  };

  const upcoming = sessions.filter((s) => s.allocationId === e.allocationId && s.date >= todayIst(now) && s.status !== 'Cancelled').slice(0, 4);

  return (
    <li className="flex min-w-0 flex-col">
      <Tag attached tone={e.status === 'Offered' ? 'accent' : 'info'} className="self-start">
        {e.categoryName || 'Course'}
      </Tag>
      <article className="flex flex-col gap-4 rounded-lg rounded-tl-none border border-border bg-surface p-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="m-0 text-heading text-ink">{e.courseTitle}</h3>
          <StatusBadge status={e.status} />
        </header>

        {e.status === 'Offered' ? (
          expired ? (
            <Alert tone="warning">This offer expired. The seat went to the next learner on the waitlist.</Alert>
          ) : e.offerExpiresAt ? (
            <Alert tone="info" title={`Held until ${formatDateTime(e.offerExpiresAt)}`}>
              {left ? `${left} left to accept.` : null}
            </Alert>
          ) : null
        ) : null}

        {e.status === 'Waitlisted' && e.waitlistRank ? (
          <Alert tone="info">You are {ordinal(e.waitlistRank)} on the waitlist.</Alert>
        ) : null}

        <KeyValueList items={facts(e)} />
        {e.score != null ? <ScoreBar score={e.score} size="sm" /> : null}

        {e.status === 'Waitlisted' ? <SecondBest requestId={e.requestId} offeringId={e.offeringId} /> : null}

        {e.status === 'Accepted' ? (
          <div className="flex flex-col gap-2">
            <span className="font-mono text-label text-ink-muted uppercase">Upcoming Sessions</span>
            {sessionsLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : upcoming.length === 0 ? (
              <p className="m-0 text-body-sm text-ink-muted">No upcoming sessions yet. We will notify you when the schedule is set.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {upcoming.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
                    <span className="font-mono text-data text-ink tabular-nums">
                      {formatDate(s.date)} {s.startTime}–{s.endTime}
                    </span>
                    {s.status !== 'Planned' ? <StatusBadge status={s.status} /> : <span className="text-ink-muted">{s.spaceName}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {e.status === 'Offered' && !expired ? (
          <div className="flex flex-wrap gap-2 border-t border-dashed border-border-strong pt-4">
            <Button variant={primary ? 'primary' : 'secondary'} icon="check" loading={accepting} onClick={() => void accept()}>
              Accept Offer
            </Button>
            <Button variant="ghost" onClick={() => setDeclineOpen(true)} disabled={accepting}>
              Decline
            </Button>
          </div>
        ) : null}

        {e.status === 'Accepted' ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border-strong pt-4">
            {ratingLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : rated != null ? (
              <span className="text-body-sm text-ink-muted">
                You rated this course <span className="font-mono text-data text-ink tabular-nums">{rated} of 5</span>.
              </span>
            ) : (
              <Button icon="star" onClick={() => setRateOpen(true)}>
                Rate Course
              </Button>
            )}
          </div>
        ) : null}
      </article>

      <ConfirmDialog
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        onConfirm={decline}
        title="Decline Offer?"
        description={`Your seat in ${e.courseTitle} goes to the next learner. Your request will be marked declined.`}
        confirmLabel="Decline Offer"
        cancelLabel="Keep Offer"
        tone="danger"
      />
      {e.status === 'Accepted' && rated == null && !ratingLoading ? (
        <RateCourseDialog open={rateOpen} onClose={() => setRateOpen(false)} enrollmentId={e.id} courseTitle={e.courseTitle} />
      ) : null}
    </li>
  );
}

/** For a waitlisted request: the best alternative that is not this class. */
function SecondBest({ requestId, offeringId }: { requestId: string; offeringId: string }) {
  const query = useQuery({
    queryKey: requestKeys.recommendations(requestId),
    queryFn: () => apiGet<RecommendationResult>('/api/recommendations', { requestId }),
  });
  if (query.isPending) return <Skeleton className="h-14 w-full" />;
  const alt = (query.data?.items ?? []).find((i) => i.offeringId !== offeringId);
  if (!alt) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surface-sunken p-3">
      <span className="font-mono text-label text-ink-muted uppercase">Another Option</span>
      <span className="text-body font-medium text-ink">{alt.offeringTitle ?? alt.categoryName}</span>
      <span className="font-mono text-data text-ink-muted tabular-nums">
        {[alt.session, alt.distanceKm != null ? formatKm(alt.distanceKm) : null, alt.feePerMonth != null ? `${formatInr(alt.feePerMonth)} / month` : null]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {alt.reasons[0] ? <span className="text-body-sm text-ink-muted">{alt.reasons[0]}</span> : null}
      <span className="font-mono text-data text-ink tabular-nums">Compatibility score {alt.score.toFixed(2)}</span>
    </div>
  );
}

/** /offers (Learner): offers with accept / decline, waitlist positions, accepted classes and ratings. */
export function OffersView() {
  const now = useNow();
  const enrollments = useQuery({ queryKey: offerKeys.mine, queryFn: () => apiGet<MyEnrollmentDto[]>('/api/enrollments/mine') });
  const hasAccepted = (enrollments.data ?? []).some((e) => e.status === 'Accepted');
  const schedules = useQuery({
    queryKey: offerKeys.schedules,
    queryFn: () => apiGet<ScheduleDto[]>('/api/schedules', { mine: 1 }),
    enabled: hasAccepted,
  });
  const feedback = useQuery({ queryKey: offerKeys.feedback, queryFn: () => apiGet<FeedbackList>('/api/feedback'), enabled: hasAccepted });
  const ratedBy = new Map((feedback.data?.items ?? []).map((f) => [f.enrollmentId, f.rating]));

  const header = <PageHeader title="Offers" description="Seats held for you, your waitlist places and the classes you joined." />;

  if (enrollments.isPending) {
    return (
      <>
        {header}
        <PanelGrid columns={2}>
          {[0, 1].map((i) => (
            <Panel key={i}>
              <Skeleton className="h-72 w-full" />
            </Panel>
          ))}
        </PanelGrid>
      </>
    );
  }
  if (enrollments.error) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState error={enrollments.error} onRetry={() => void enrollments.refetch()} />
        </Panel>
      </>
    );
  }
  const all = enrollments.data ?? [];
  if (all.length === 0) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            icon="ticket"
            description="No offers yet. When Smart Allocation finds a class for one of your requests, it appears here."
            action={<Button href="/discover" icon="compass">Discover Courses</Button>}
          />
        </Panel>
      </>
    );
  }

  const firstOfferId = all.find((e) => e.status === 'Offered' && (!e.offerExpiresAt || timeLeft(e.offerExpiresAt, now)))?.id;

  return (
    <>
      {header}
      <div className="flex flex-col">
        {OFFER_GROUPS.map((g) => {
          const rows = all.filter((e) => g.statuses.includes(e.status));
          if (rows.length === 0) return null;
          return (
            <Panel key={g.key} title={g.title} description={g.description} className="border-b border-border">
              <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 lg:grid-cols-2">
                {rows.map((e) => (
                  <OfferCard
                    key={e.id}
                    enrollment={e}
                    now={now}
                    primary={e.id === firstOfferId}
                    sessions={schedules.data ?? []}
                    sessionsLoading={schedules.isPending && hasAccepted}
                    rated={ratedBy.get(e.id) ?? null}
                    ratingLoading={feedback.isPending && hasAccepted}
                  />
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
