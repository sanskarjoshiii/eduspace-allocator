'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { Role } from '@/lib/domain';
import type { DashboardResponse } from '@/server/dto/analytics';
import { Alert, Button, ErrorState, PageHeader, Panel } from '@/components/ui';
import { useTriggerRun } from '@/components/runs/run-hooks';
import { AdminDashboard } from './admin-dashboard';
import { DashboardSkeleton, dashboardKeys } from './dashboard-parts';
import { LearnerDashboard } from './learner-dashboard';
import { ProviderDashboard } from './provider-dashboard';
import { SpaceGiverDashboard } from './space-giver-dashboard';

const DESCRIPTION: Record<Role, string> = {
  Administrator: 'Coverage, utilisation and what needs attention across EduSpace.',
  Learner: 'Your requests, offers and classes that fit you.',
  SpaceGiver: 'How your spaces are used and what needs your approval.',
  CourseProvider: 'Your offerings, their spaces and where learners are waiting.',
};

function RunAllocationButton() {
  const run = useTriggerRun();
  return (
    <Button variant="primary" icon="play" loading={run.isPending} onClick={() => run.mutate()}>
      Run Allocation
    </Button>
  );
}

function PrimaryAction({ role }: { role: Role }) {
  switch (role) {
    case 'Administrator':
      return <RunAllocationButton />;
    case 'Learner':
      return (
        <Button variant="primary" icon="plus" href="/requests/new">
          New Request
        </Button>
      );
    case 'SpaceGiver':
      return (
        <Button variant="primary" icon="plus" href="/spaces/new">
          Add Space
        </Button>
      );
    case 'CourseProvider':
      return (
        <Button variant="primary" icon="plus" href="/offerings/new">
          New Offering
        </Button>
      );
    default:
      return null;
  }
}

/** One dashboard route; renders the widgets for the signed-in role from GET /api/analytics/dashboard. */
export function DashboardView({ role, denied }: { role: Role; denied?: boolean }) {
  const query = useQuery({
    queryKey: dashboardKeys.all,
    queryFn: () => apiGet<DashboardResponse>('/api/analytics/dashboard'),
    staleTime: 30_000,
  });
  const data = query.data;

  return (
    <>
      <PageHeader title="Dashboard" description={DESCRIPTION[role]} actions={<PrimaryAction role={role} />} />
      {denied ? (
        <div className="border-b border-border px-4 py-3 lg:px-6">
          <Alert tone="warning" title="That page is not available to you">
            You were brought back to your dashboard.
          </Alert>
        </div>
      ) : null}
      {query.isPending ? (
        <DashboardSkeleton kpis={role === 'Administrator' ? 6 : 3} />
      ) : query.isError || !data ? (
        <Panel>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Panel>
      ) : data.role === 'Administrator' ? (
        <AdminDashboard data={data} />
      ) : data.role === 'Learner' ? (
        <LearnerDashboard data={data} />
      ) : data.role === 'SpaceGiver' ? (
        <SpaceGiverDashboard data={data} />
      ) : (
        <ProviderDashboard data={data} />
      )}
    </>
  );
}
