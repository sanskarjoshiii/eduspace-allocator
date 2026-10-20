'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, EmptyState, ErrorState, PageHeader, Panel, PanelGrid, Skeleton, Tag } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { formatInr, formatKm, formatNumber } from '@/lib/format';
import type { DiscoverCategory, DiscoverOffering, DiscoverResult } from '@/server/services/recommendations';

const requestHref = (categoryId: string) => `/requests/new?categoryId=${encodeURIComponent(categoryId)}`;

function Reasons({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-body-sm text-ink-muted">
      {reasons.map((r, i) => (
        <li key={i}>{r}</li>
      ))}
    </ul>
  );
}

function OfferingCard({ o, areaName }: { o: DiscoverOffering; areaName: string | null }) {
  return (
    <li className="flex min-w-0 flex-col">
      <Tag attached tone="info" className="self-start">
        {o.categoryName}
      </Tag>
      <article className="flex flex-1 flex-col gap-3 rounded-lg rounded-tl-none border border-border bg-surface p-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="m-0 text-heading text-ink">{o.title}</h3>
            <span className="text-body-sm text-ink-muted">{[o.providerName, o.spaceName, o.areaName].filter(Boolean).join(' · ')}</span>
          </div>
          {o.matchesRequest ? <Badge tone="success">Matches your request</Badge> : null}
        </header>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {[
            { label: 'Session', value: o.session ?? 'To be set' },
            { label: 'Fee', value: o.feePerMonth != null ? `${formatInr(o.feePerMonth)} / mo` : '—' },
            { label: 'Seats left', value: formatNumber(o.seatsLeft) },
            { label: 'Distance', value: o.distanceKm != null ? formatKm(o.distanceKm) : '—' },
          ].map((f) => (
            <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="font-mono text-label text-ink-muted uppercase">{f.label}</dt>
              <dd className="m-0 font-mono text-data text-ink tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
        {o.distanceKm != null && areaName ? <p className="m-0 text-body-sm text-ink-subtle">Distance from {areaName} (area centre).</p> : null}
        <Reasons reasons={o.reasons} />
        <div className="mt-auto pt-1">
          <Button size="sm" icon="plus" href={requestHref(o.categoryId)}>
            Request This Course
          </Button>
        </div>
      </article>
    </li>
  );
}

function CategoryList({ items, empty }: { items: DiscoverCategory[]; empty: string }) {
  if (items.length === 0) return <EmptyState icon="compass" size="compact" description={empty} />;
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map((c) => (
        <li key={c.categoryId} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-body font-medium text-ink">{c.categoryName}</span>
            <Button size="sm" icon="plus" href={requestHref(c.categoryId)}>
              Request This Course
            </Button>
          </div>
          <Reasons reasons={c.reasons} />
        </li>
      ))}
    </ul>
  );
}

/** Discover Courses (F-36): open classes with seats near the learner's area, plus suggested categories. */
export function DiscoverView() {
  const query = useQuery({ queryKey: ['recommendations', 'discover'], queryFn: () => apiGet<DiscoverResult>('/api/recommendations/discover') });
  const d = query.data;
  const header = <PageHeader title="Discover Courses" description="Open classes with free seats near you, and courses in demand around your area." />;

  if (query.isPending) {
    return (
      <>
        {header}
        <Panel title="Open Classes Near You">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-60 w-full" />
            ))}
          </div>
        </Panel>
      </>
    );
  }
  if (query.error || !d) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </>
    );
  }

  return (
    <>
      {header}
      {!d.areaId ? (
        <div className="border-b border-border px-4 py-3 lg:px-6">
          <Alert tone="info" title="Set your home area" action={<Button size="sm" href="/profile">Open Profile</Button>}>
            Add your home area or submit a request so we can show classes near you.
          </Alert>
        </div>
      ) : null}
      <Panel
        title={d.areaName ? `Open Classes Near ${d.areaName}` : 'Open Classes'}
        description={`Classes with free seats within ${formatKm(d.radiusKm)} of your area centre. Those matching your requests come first.`}
        className="border-b border-border"
      >
        {d.offerings.length === 0 ? (
          <EmptyState
            icon="book-open"
            description="No open classes near you right now. Submit a request and we will match you when one appears."
            action={<Button href="/requests/new" icon="plus">New Request</Button>}
          />
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 lg:grid-cols-2">
            {d.offerings.map((o) => (
              <OfferingCard key={o.offeringId} o={o} areaName={d.areaName} />
            ))}
          </ul>
        )}
      </Panel>
      <PanelGrid columns={2}>
        <Panel title="In Demand Nearby" description="Courses many learners around you are asking for.">
          <CategoryList items={d.highDemandCategories} empty="No high-demand courses near you yet." />
        </Panel>
        <Panel title="Similar To Your Requests" description="Related courses to the ones you asked for.">
          <CategoryList items={d.similarCategories} empty="Submit a request to see related courses." />
        </Panel>
      </PanelGrid>
    </>
  );
}
