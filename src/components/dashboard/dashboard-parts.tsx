'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatNumber } from '@/lib/format';
import type { AreaDemandDto } from '@/server/dto/insight';
import { DataTable, EmptyState, Icon, Panel, PanelGrid, Skeleton, SkeletonText, StatCard, StatusBadge, cn, type DataTableColumn, type IconName } from '@/components/ui';

export const dashboardKeys = { all: ['dashboard'] as const };

const demandColumns: DataTableColumn<AreaDemandDto>[] = [
  { key: 'areaName', header: 'Area' },
  { key: 'demandLevel', header: 'Level', cell: (r) => (r.demandLevel ? <StatusBadge status={r.demandLevel} /> : <span className="text-ink-subtle">—</span>) },
  { key: 'openRequests', header: 'Open Requests', align: 'end', cell: (r) => formatNumber(r.openRequests) },
  { key: 'seatsOffered', header: 'Seats Offered', align: 'end', hideBelow: 'sm', cell: (r) => formatNumber(r.seatsOffered) },
  { key: 'gap', header: 'Gap', align: 'end', cell: (r) => <span className={cn('tabular-nums', r.gap > 0 && 'font-medium text-ink')}>{formatNumber(r.gap)}</span> },
];

/** Aggregated demand per area (never individual learners). */
export function DemandTable({ rows, caption, empty }: { rows: readonly AreaDemandDto[]; caption: string; empty: string }) {
  return (
    <DataTable
      caption={caption}
      columns={demandColumns}
      rows={rows}
      rowKey={(r) => r.areaId}
      pageSize={0}
      empty={<EmptyState size="compact" icon="chart-line" description={empty} />}
    />
  );
}

/** A dashed-rule row for short dashboard lists. */
export function ListRow({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn('flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-border-strong py-3 first:pt-0 last:border-b-0 last:pb-0', className)}>{children}</li>;
}

/** Skeleton shaped like a dashboard: a KPI row and two panels. */
export function DashboardSkeleton({ kpis = 3 }: { kpis?: number }) {
  return (
    <>
      <PanelGrid columns={3}>
        {Array.from({ length: kpis }, (_, i) => (
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

/** Tray-eyebrow link styled like IconButton (IconButton renders a button and takes no href). */
export function IconLink({ href, label, icon = 'arrow-up-right' }: { href: string; label: string; icon?: IconName }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-grid size-control-sm flex-none place-items-center rounded-sm text-ink-muted transition-colors duration-120 ease-out hover:bg-surface-tint hover:text-ink"
    >
      <Icon name={icon} size={16} />
    </Link>
  );
}
