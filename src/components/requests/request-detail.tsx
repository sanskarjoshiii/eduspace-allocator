'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, ConfirmDialog, EmptyState, ErrorState, KeyValueList, PageHeader, Panel, PanelGrid, ScoreBar, Skeleton,
  SkeletonText, StatusBadge, Tag, Timeline, useToast, type KeyValueItem,
} from '@/components/ui';
import { useLookups } from '@/hooks/use-lookups';
import { useMe } from '@/hooks/use-me';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { formatDate, formatDateTime, formatInr, formatKm } from '@/lib/format';
import { EDITABLE_REQUEST_STATUSES } from '@/schemas/request';
import { RequestForm } from './request-form';
import {
  buildTimeline, formatMonth, formatWindows, isClosed, requestKeys,
  type MatchedRequestDto, type RecommendationItem, type RecommendationResult, type RequestDto, type RequestFullDto,
} from './request-utils';

function useRequest(id: string) {
  return useQuery({
    queryKey: requestKeys.detail(id),
    queryFn: () => apiGet<RequestDto>(`/api/requests/${encodeURIComponent(id)}`),
    retry: (count, err) => !(err instanceof ApiError && (err.status === 404 || err.status === 403)) && count < 2,
  });
}

function DetailSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-4 lg:px-6 lg:py-5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <PanelGrid columns={2}>
        <Panel title="Status">
          <SkeletonText lines={6} />
        </Panel>
        <Panel title="Details">
          <SkeletonText lines={6} />
        </Panel>
      </PanelGrid>
    </>
  );
}

/** /requests/[id]: timeline, details, suggestions and actions. */
export function RequestDetail({ id }: { id: string }) {
  const query = useRequest(id);
  if (query.isPending) return <DetailSkeleton />;
  if (query.error || !query.data) {
    return (
      <>
        <PageHeader title="Learning Request" />
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </>
    );
  }
  return query.data.visibility === 'full' ? <FullRequest request={query.data} /> : <MatchedRequest request={query.data} />;
}

/** /requests/[id]/edit. */
export function RequestEdit({ id }: { id: string }) {
  const query = useRequest(id);
  if (query.isPending) return <DetailSkeleton />;
  if (query.error || !query.data) {
    return (
      <>
        <PageHeader title="Edit Request" />
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </>
    );
  }
  const r = query.data;
  if (r.visibility !== 'full' || !(EDITABLE_REQUEST_STATUSES as readonly string[]).includes(r.status)) {
    return (
      <>
        <PageHeader title="Edit Request" />
        <Panel>
          <EmptyState
            icon="pencil"
            description="This request can no longer be edited. Requests can change only before a class is offered."
            action={<Button href={`/requests/${id}`}>Back To Request</Button>}
          />
        </Panel>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Edit Request" description={`Change your ${r.categoryName ?? 'course'} request. Matching runs again after you save.`} />
      <RequestForm existing={r} />
    </>
  );
}

function FullRequest({ request: r }: { request: RequestFullDto }) {
  const me = useMe();
  const lookups = useLookups();
  const toast = useToast();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const isAdmin = me.data?.role === 'Administrator';
  const isOwner = me.data?.id === r.learnerUserId;
  const canEdit = (isOwner || isAdmin) && (EDITABLE_REQUEST_STATUSES as readonly string[]).includes(r.status);
  const canCancel = (isOwner || isAdmin) && !isClosed(r.status);

  const facilityNames = r.requiredFacilityTypeIds
    .map((fid) => lookups.data?.facilityTypes.find((f) => f.id === fid)?.name)
    .filter((n): n is string => Boolean(n));
  const [lng, lat] = r.location;

  const items: KeyValueItem[] = [
    ...(isAdmin ? [{ label: 'Learner', value: r.learnerName ?? '—' }, { label: 'Audience', value: r.audience }] : []),
    { label: 'Course category', value: r.categoryName ?? '—' },
    { label: 'Area', value: r.areaName ? `${r.areaName} (area centre)` : '—' },
    { label: isAdmin ? 'Exact location' : 'Your exact location (private)', value: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, mono: true },
    { label: 'Maximum distance', value: formatKm(r.maxDistanceKm), mono: true },
    { label: 'Preferred times', value: formatWindows(r.windows), mono: true },
    { label: 'Start month', value: formatMonth(r.startMonth), mono: true },
    { label: 'Duration', value: `${r.durationMonths} ${r.durationMonths === 1 ? 'month' : 'months'}` },
    { label: 'Required facilities', value: r.requiredFacilityTypeIds.length ? facilityNames.join(', ') || `${r.requiredFacilityTypeIds.length} selected` : 'None' },
    { label: 'Budget per month', value: r.budgetPerMonth != null ? formatInr(r.budgetPerMonth) : 'Any', mono: r.budgetPerMonth != null },
    { label: 'Consent recorded', value: formatDateTime(r.consentAt), mono: true },
    ...(r.notes ? [{ label: 'Notes', value: r.notes }] : []),
  ];

  const cancel = async () => {
    try {
      await apiSend('POST', `/api/requests/${r.id}/cancel`);
      await qc.invalidateQueries({ queryKey: requestKeys.all });
      toast.success('Request cancelled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not cancel the request. Try again.');
      throw err;
    }
  };

  return (
    <>
      <PageHeader
        title={r.categoryName ?? 'Learning Request'}
        description={`${isAdmin && r.learnerName ? `${r.learnerName}'s request` : 'Your request'}, submitted ${formatDate(r.createdAt)}.`}
        meta={<StatusBadge status={r.status} />}
        actions={
          <>
            {canEdit ? (
              <Button icon="pencil" href={`/requests/${r.id}/edit`}>
                Edit
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="danger" icon="x" onClick={() => setCancelOpen(true)}>
                Cancel Request
              </Button>
            ) : null}
            {r.status === 'Offered' && isOwner ? (
              <Button variant="primary" icon="ticket" href="/offers">
                View Offer
              </Button>
            ) : null}
          </>
        }
      />
      {r.status === 'Offered' && isOwner ? (
        <div className="border-b border-border px-4 py-3 lg:px-6">
          <Alert tone="info" title="You have an offer">
            A class has a seat for you. Accept or decline it on the Offers page before it expires.
          </Alert>
        </div>
      ) : null}
      <PanelGrid columns={2}>
        <Panel title="Status" description="Each step of your request, newest at the bottom.">
          <Timeline steps={buildTimeline(r.status, r.statusTimeline)} label="Request status timeline" />
        </Panel>
        <Panel title="Details" description="What you asked for. Only you and administrators see your exact location.">
          <KeyValueList items={items} />
        </Panel>
        {r.status === 'Unmatched' ? <Suggestions request={r} /> : null}
      </PanelGrid>
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={cancel}
        title="Cancel Request?"
        description="We will stop looking for a class for this request and release any seat held for you. This cannot be undone."
        confirmLabel="Cancel Request"
        cancelLabel="Keep Request"
        tone="danger"
      />
    </>
  );
}

function SuggestionCard({ item, requestCategoryId }: { item: RecommendationItem; requestCategoryId: string }) {
  const where = [item.spaceName, item.areaName].filter(Boolean).join(', ');
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-body font-medium text-ink">{item.offeringTitle ?? item.categoryName}</span>
          <span className="text-body-sm text-ink-muted">{[item.providerName, where].filter(Boolean).join(' · ') || 'Suggested course'}</span>
        </div>
        <Tag tone="info">{item.categoryName}</Tag>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-data text-ink tabular-nums">
        {item.session ? <span>{item.session}</span> : null}
        {item.feePerMonth != null ? <span>{formatInr(item.feePerMonth)} / month</span> : null}
        {item.distanceKm != null ? <span>{formatKm(item.distanceKm)} from your area centre</span> : null}
      </div>
      <ScoreBar score={item.score} size="sm" />
      {item.reasons.length ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-body-sm text-ink-muted">
          {item.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {item.categoryId !== requestCategoryId ? (
        <div>
          <Button size="sm" icon="plus" href={`/requests/new?categoryId=${encodeURIComponent(item.categoryId)}`}>
            Request This Course
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function Suggestions({ request }: { request: RequestFullDto }) {
  const query = useQuery({
    queryKey: requestKeys.recommendations(request.id),
    queryFn: () => apiGet<RecommendationResult>('/api/recommendations', { requestId: request.id }),
  });
  const items = (query.data?.items ?? []).slice(0, 3);
  return (
    <Panel title="Suggested Options" description="The closest alternatives we found, with why each one fits." className="lg:col-span-2">
      <div className="flex flex-col gap-4">
        <Alert tone="info">Your request stays open. We will match you when a suitable class appears.</Alert>
        {query.isPending ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} size="compact" />
        ) : items.length === 0 ? (
          <EmptyState
            icon="compass"
            size="compact"
            description="No alternatives right now. Browse open classes near you in the meantime."
            action={<Button href="/discover" icon="compass">Discover Courses</Button>}
          />
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-3">
            {items.map((item, i) => (
              <SuggestionCard key={`${item.offeringId ?? item.categoryId}-${i}`} item={item} requestCategoryId={request.categoryId} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/** A request as a matched Course Provider or Space Giver may see it: only what the DTO carries. */
function MatchedRequest({ request: m }: { request: MatchedRequestDto }) {
  const l = m.learner;
  const items: KeyValueItem[] = [{ label: 'Class', value: m.offeringTitle ?? '—' }];
  if (l.visibility === 'provider-accepted') {
    items.push(
      { label: 'Learner', value: l.name },
      { label: 'Age band', value: l.ageBand || '—' },
      { label: 'Phone', value: l.contactPhone || '—', mono: Boolean(l.contactPhone) },
      { label: 'Email', value: l.contactEmail || '—' },
      { label: 'Accessibility needs', value: l.accessibilityNeeds.length ? l.accessibilityNeeds.join(', ') : 'None stated' },
      { label: 'Course category', value: l.categoryName || '—' },
      { label: 'Area', value: `${l.areaName} (area centre)` },
      { label: 'Preferred times', value: formatWindows(l.windows), mono: true },
      { label: 'Start month', value: formatMonth(l.startMonth), mono: true },
      { label: 'Duration', value: `${l.durationMonths} ${l.durationMonths === 1 ? 'month' : 'months'}` },
    );
  } else if (l.visibility === 'roster') {
    items.push({ label: 'Learner', value: l.name });
  } else {
    items.push({ label: 'Area', value: `${l.areaName} (area centre)` }, { label: 'Preferred times', value: formatWindows(l.windows), mono: true });
  }
  const note =
    l.visibility === 'cohort'
      ? 'The learner has not accepted yet, so only their area and preferred times are shared.'
      : l.visibility === 'roster'
        ? 'Only the learner’s name is shared with the space, for entry.'
        : 'The learner accepted, so their contact details are shared with you.';

  return (
    <>
      <PageHeader title="Matched Request" description={m.offeringTitle ?? 'A learner matched to your class.'} meta={<StatusBadge status={m.enrollmentStatus} />} />
      <PanelGrid columns={1}>
        <Panel title="Learner" description={note}>
          <KeyValueList items={items} />
        </Panel>
      </PanelGrid>
    </>
  );
}
