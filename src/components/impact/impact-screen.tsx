'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { LineChart } from '@/components/charts';
import {
  Alert, Button, Delta, EmptyState, ErrorState, KeyValueList, PageHeader, Panel, PanelGrid, Progress, StatCard, TabPanel, Tabs,
} from '@/components/ui';
import { apiGet } from '@/lib/api';
import { formatDateTime, formatKm, formatNumber, formatPercent } from '@/lib/format';
import type { ImpactMetrics, ImpactResponse } from '@/server/dto/impact';
import { formatPeriod } from './impact-utils';

type MetricKey = 'learnersServed' | 'learningHours' | 'sessionsScheduled' | 'spacesUsed';

const TREND_TABS: { value: MetricKey; label: string; series: string }[] = [
  { value: 'learnersServed', label: 'Learners', series: 'Learners served' },
  { value: 'learningHours', label: 'Learning Hours', series: 'Learning hours' },
  { value: 'sessionsScheduled', label: 'Sessions', series: 'Sessions scheduled' },
  { value: 'spacesUsed', label: 'Spaces', series: 'Spaces used' },
];


/** Month-on-month change in percent, when there is a previous month to compare against. */
function change(current: number, previous: number | undefined): number | undefined {
  if (previous === undefined || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

export function ImpactScreen() {
  const [metric, setMetric] = useState<MetricKey>('learnersServed');
  const query = useQuery({ queryKey: ['impact'], queryFn: () => apiGet<ImpactResponse>('/api/impact') });

  const latest = query.data?.latest;
  const previous = useMemo<ImpactMetrics | undefined>(() => {
    const history = query.data?.history ?? [];
    const before = history.filter((h) => latest && h.period < latest.period);
    return before.at(-1)?.metrics;
  }, [query.data, latest]);
  const trend = useMemo(() => {
    const history = query.data?.history ?? [];
    const rows = latest && !history.some((h) => h.period === latest.period) ? [...history, latest] : history;
    return rows.map((h) => ({ period: formatPeriod(h.period), ...h.metrics }));
  }, [query.data, latest]);
  const tab = TREND_TABS.find((t) => t.value === metric) ?? TREND_TABS[0]!;
  const m = latest?.metrics;
  const loading = query.isPending;

  const card = (key: keyof ImpactMetrics) => (m ? change(m[key], previous?.[key]) : undefined);
  const footnoteFor = (key: keyof ImpactMetrics, unit: string) =>
    m && previous ? (
      <>
        <strong>{formatNumber(previous[key])}</strong> {unit} last month.
      </>
    ) : undefined;

  return (
    <>
      <PageHeader
        title="Social Impact"
        description="What EduSpace has delivered: learners served, hours of learning and idle spaces put to use."
        meta={latest ? <span className="font-mono text-data text-ink-muted">{formatPeriod(latest.period)}, updated {formatDateTime(latest.computedAt)}</span> : null}
        actions={
          <Button href="/sdg" icon="globe">
            SDG Dashboard
          </Button>
        }
      />

      {query.isError ? (
        <PanelGrid columns={1}>
          <Panel>
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </Panel>
        </PanelGrid>
      ) : (
        <>
          {latest && !latest.stored ? (
            <div className="border-b border-border px-4 py-3 lg:px-6">
              <Alert tone="info">These figures are calculated live. This month is saved as a snapshot each night.</Alert>
            </div>
          ) : null}
          <PanelGrid columns={3}>
            <Panel>
              <StatCard icon="graduation-cap" label="Learners Served" size="xl" value={m ? formatNumber(m.learnersServed) : undefined} delta={card('learnersServed')} footnote={footnoteFor('learnersServed', 'learners')} loading={loading} />
            </Panel>
            <Panel>
              <StatCard icon="clock" label="Learning Hours" size="xl" value={m ? formatNumber(Math.round(m.learningHours)) : undefined} delta={card('learningHours')} footnote={footnoteFor('learningHours', 'hours')} loading={loading} />
            </Panel>
            <Panel>
              <StatCard icon="calendar" label="Sessions Scheduled" size="xl" value={m ? formatNumber(m.sessionsScheduled) : undefined} delta={card('sessionsScheduled')} footnote={footnoteFor('sessionsScheduled', 'sessions')} loading={loading} />
            </Panel>
            <Panel>
              <StatCard icon="building-2" label="Spaces Used" value={m ? formatNumber(m.spacesUsed) : undefined} delta={card('spacesUsed')} footnote="Idle rooms now hosting classes." loading={loading} />
            </Panel>
            <Panel>
              <StatCard icon="clock" label="Idle Hours Used" value={m ? `${formatNumber(Math.round(m.idleHoursUsed))} h` : undefined} delta={card('idleHoursUsed')} footnote="Booked hours each week in rooms that would sit empty." loading={loading} />
            </Panel>
            <Panel>
              <StatCard icon="map-pin" label="Areas Reached" value={m ? formatNumber(m.areasReached) : undefined} delta={card('areasReached')} footnote={m ? <><strong>{formatNumber(m.highDemandAreasServed)}</strong> of them are high-demand areas.</> : undefined} loading={loading} />
            </Panel>
            <Panel>
              <StatCard
                icon="map-pin"
                label="Average Distance"
                value={m ? formatKm(m.avgDistanceKm) : undefined}
                delta={m && previous && previous.avgDistanceKm > 0 ? <Delta value={change(m.avgDistanceKm, previous.avgDistanceKm) ?? 0} invert /> : undefined}
                footnote="Mean travel distance for learners who accepted a seat."
                loading={loading}
              />
            </Panel>
            <Panel>
              <StatCard icon="building-2" label="Space Utilisation" title="Booked share of open weekly hours" loading={loading}>
                {m ? <Progress value={m.spaceUtilisation * 100} label="Space utilisation" startLabel={`${formatPercent(m.spaceUtilisation)} booked`} endLabel="Open hours" /> : null}
              </StatCard>
            </Panel>
            <Panel title="Partners" description="Organisations and people making classes happen." icon="heart-handshake">
              {m ? (
                <KeyValueList
                  items={[
                    { label: 'Active Space Givers', value: formatNumber(m.activeSpaceGivers), mono: true },
                    { label: 'Active Course Providers', value: formatNumber(m.activeProviders), mono: true },
                    { label: 'Providers with a venue', value: formatNumber(m.providersWithVenue), mono: true },
                    { label: 'Partner organisations', value: formatNumber(m.ngoPartners), mono: true },
                  ]}
                />
              ) : (
                <StatCard label="Loading" loading />
              )}
            </Panel>
          </PanelGrid>

          <PanelGrid columns={1}>
            <Panel title="Monthly History" description="Up to the last 12 months, one point per month." icon="chart-line">
              <div className="flex flex-col gap-4">
                <Tabs id="impact-trend" label="Trend metric" items={TREND_TABS} value={metric} onValueChange={(v) => setMetric(v as MetricKey)} />
                {!loading && trend.length === 0 ? (
                  <EmptyState icon="chart-line" size="compact" description="No monthly history yet. The first snapshot is saved tonight." />
                ) : (
                  <TabPanel id="impact-trend" value={metric} active={metric}>
                    <LineChart
                      data={trend}
                      xKey="period"
                      series={[{ key: metric, label: tab.series }]}
                      label={`${tab.series} by month for ${trend.length} months`}
                      loading={loading}
                      valueFormatter={(v) => formatNumber(Math.round(v))}
                      height={260}
                    />
                  </TabPanel>
                )}
              </div>
            </Panel>
          </PanelGrid>
        </>
      )}
    </>
  );
}
