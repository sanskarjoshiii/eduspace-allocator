'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Button, EmptyState, ErrorState, PageHeader, Panel, PanelGrid, SkeletonText, Skeleton, Tag } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { formatDateTime, formatKm, formatNumber, formatPercent } from '@/lib/format';
import type { SdgGoal, SdgIndicator, SdgResponse } from '@/server/dto/impact';
import { formatPeriod } from './impact-utils';

/** How EduSpace contributes to each goal, in one sentence. */
const GOAL_NOTE: Record<SdgGoal['goal'], string> = {
  4: 'More learners reach a nearby class with the facilities it needs.',
  8: 'Tutors and course providers find affordable venues and keep teaching.',
  9: 'Rooms that sit idle become shared learning infrastructure.',
  10: 'Classes reach areas with high demand and fewer options.',
  11: 'Shorter trips to class and better use of the spaces a city already has.',
  17: 'Space Givers, providers and partner organisations working together.',
};

function formatIndicator(i: SdgIndicator): string {
  switch (i.unit) {
    case 'hours':
      return `${formatNumber(Math.round(i.value))} h`;
    case 'km':
      return formatKm(i.value);
    case 'ratio':
      return formatPercent(i.value);
    default:
      return formatNumber(i.value);
  }
}

export function SdgScreen() {
  const query = useQuery({ queryKey: ['sdg'], queryFn: () => apiGet<SdgResponse>('/api/sdg') });
  const data = query.data;

  return (
    <>
      <PageHeader
        title="SDG Dashboard"
        description="How EduSpace contributes to six UN Sustainable Development Goals, measured from live platform data."
        meta={data ? <span className="font-mono text-data text-ink-muted">{formatPeriod(data.period)}, updated {formatDateTime(data.computedAt)}</span> : null}
        actions={
          <Button href="/impact" icon="heart-handshake">
            Social Impact
          </Button>
        }
      />
      {query.isError ? (
        <PanelGrid columns={1}>
          <Panel>
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </Panel>
        </PanelGrid>
      ) : !data ? (
        <PanelGrid columns={3}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Panel key={i}>
              <Skeleton className="mb-3 h-6 w-32" />
              <SkeletonText lines={3} />
            </Panel>
          ))}
        </PanelGrid>
      ) : data.goals.length === 0 ? (
        <PanelGrid columns={1}>
          <Panel>
            <EmptyState icon="globe" description="No goal data yet. Figures appear once classes are scheduled." />
          </Panel>
        </PanelGrid>
      ) : (
        <PanelGrid columns={3}>
          {[...data.goals]
            .sort((a, b) => a.goal - b.goal)
            .map((g) => (
              <GoalPanel key={g.goal} goal={g} />
            ))}
        </PanelGrid>
      )}
    </>
  );
}

function GoalPanel({ goal }: { goal: SdgGoal }) {
  const headingId = `sdg-${goal.goal}`;
  return (
    <Panel>
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <div>
            <Tag tone="accent">SDG {goal.goal}</Tag>
          </div>
          <h2 id={headingId} className="m-0 text-heading text-ink">
            {goal.title}
          </h2>
          <p className="m-0 text-body-sm text-ink-muted">{GOAL_NOTE[goal.goal]}</p>
        </div>
        <dl className="m-0 flex flex-col">
          {goal.indicators.map((i) => (
            <div key={i.key} className="flex items-baseline justify-between gap-3 border-t border-dashed border-border-strong py-2.5">
              <dt className="flex min-w-0 flex-wrap items-center gap-2 text-body-sm text-ink">
                {i.label}
                {i.source === 'live' ? <Badge tone="info">Live</Badge> : null}
              </dt>
              <dd className="m-0 flex-none text-figure-lg tabular-nums text-ink">{formatIndicator(i)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Panel>
  );
}
