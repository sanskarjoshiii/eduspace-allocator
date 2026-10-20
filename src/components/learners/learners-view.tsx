'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Badge, Button, Checkbox, DataTable, Dialog, EmptyState, ErrorState, PageHeader, Panel, PanelGrid, Progress, Select,
  Skeleton, StatCard, StatusBadge, useToast, type DataTableColumn,
} from '@/components/ui';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';
import type { AllocationListItemDto } from '@/server/dto/allocation';
import type { RosterDto, RosterEntryDto } from '@/server/dto/enrollment';
import type { LearnerView } from '@/server/dto/privacy';
import type { ScheduleDto } from '@/server/dto/schedule';
import type { AttendanceReport } from '@/server/services/attendance';
import type { FeedbackList } from '@/server/services/feedback';
import { todayIst } from '@/components/offers/offer-utils';

const HIDDEN_ALLOCATION_STATUSES = ['Rejected', 'Superseded', 'Cancelled'];

const learnerKeys = {
  allocations: ['allocations', 'learners-picker'] as const,
  roster: (id: string) => ['enrollments', 'roster', id] as const,
  schedules: (id: string) => ['schedules', 'allocation', id] as const,
  attendance: (id: string) => ['attendance', id] as const,
  feedback: (offeringId: string) => ['feedback', 'offering', offeringId] as const,
};

/** Name for a learner as far as the view allows. */
function learnerName(v: LearnerView | null): string | null {
  if (!v) return null;
  if (v.visibility === 'provider-accepted' || v.visibility === 'roster' || v.visibility === 'full') return v.name;
  return null;
}

function contactOf(v: LearnerView | null): string {
  if (v && (v.visibility === 'provider-accepted' || v.visibility === 'full')) return [v.contactPhone, v.contactEmail].filter(Boolean).join(' · ') || 'No contact on file';
  return '—';
}

function needsOf(v: LearnerView | null): string {
  if (v && (v.visibility === 'provider-accepted' || v.visibility === 'full')) return v.accessibilityNeeds.length ? v.accessibilityNeeds.join(', ') : 'None stated';
  return '—';
}

// ---- Attendance dialog ----

function AttendanceDialog({
  session, learners, previous, onClose, allocationId,
}: {
  session: ScheduleDto | null;
  learners: RosterEntryDto[];
  /** Marks already saved for this session; an edit starts from them. */
  previous: { enrollmentId: string; present: boolean }[] | null | undefined;
  onClose: () => void;
  allocationId: string;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useMemo(() => new Map((previous ?? []).map((r) => [r.enrollmentId, r.present])), [previous]);
  const isPresent = (id: string) => present[id] ?? saved.get(id) ?? true;

  const save = async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      await apiSend('POST', '/api/attendance', {
        scheduleId: session.id,
        records: learners.map((l) => ({ enrollmentId: l.enrollmentId, present: isPresent(l.enrollmentId) })),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: learnerKeys.attendance(allocationId) }),
        qc.invalidateQueries({ queryKey: learnerKeys.schedules(allocationId) }),
      ]);
      toast.success('Attendance saved');
      setPresent({});
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save attendance. Try again.');
    } finally {
      setSaving(false);
    }
  };
  const count = learners.filter((l) => isPresent(l.enrollmentId)).length;

  return (
    <Dialog
      open={session !== null}
      onClose={() => {
        setPresent({});
        setError(null);
        onClose();
      }}
      title="Mark Attendance"
      description={session ? `${formatDate(session.date)}, ${session.startTime}–${session.endTime}. Tick everyone who attended.` : undefined}
      dismissible={!saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" onClick={() => void save()} loading={saving} disabled={learners.length === 0}>
            Save Attendance
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {learners.length === 0 ? (
          <p className="m-0 text-body-sm text-ink-muted">No accepted learners to mark yet.</p>
        ) : (
          <>
            <p className="m-0 font-mono text-data text-ink-muted tabular-nums">
              {count} of {learners.length} present
            </p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {learners.map((l, i) => (
                <li key={l.enrollmentId}>
                  <Checkbox
                    id={`att-${l.enrollmentId}`}
                    label={learnerName(l.learner) ?? `Learner ${i + 1}`}
                    checked={isPresent(l.enrollmentId)}
                    onChange={(e) => setPresent((p) => ({ ...p, [l.enrollmentId]: e.target.checked }))}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---- Allocation workspace ----

function AllocationWorkspace({ allocation }: { allocation: AllocationListItemDto }) {
  const id = allocation.id;
  const [marking, setMarking] = useState<ScheduleDto | null>(null);
  const roster = useQuery({ queryKey: learnerKeys.roster(id), queryFn: () => apiGet<RosterDto>('/api/enrollments', { allocationId: id }) });
  const schedules = useQuery({ queryKey: learnerKeys.schedules(id), queryFn: () => apiGet<ScheduleDto[]>('/api/schedules', { allocationId: id }) });
  const attendance = useQuery({ queryKey: learnerKeys.attendance(id), queryFn: () => apiGet<AttendanceReport>('/api/attendance', { allocationId: id }) });
  const feedback = useQuery({
    queryKey: learnerKeys.feedback(allocation.offeringId),
    queryFn: () => apiGet<FeedbackList>('/api/feedback', { offeringId: allocation.offeringId }),
  });

  const accepted = useMemo(() => (roster.data?.entries ?? []).filter((e) => e.status === 'Accepted'), [roster.data]);
  const rateBy = useMemo(() => new Map((attendance.data?.learners ?? []).map((l) => [l.enrollmentId, l])), [attendance.data]);
  const sessionStats = useMemo(() => new Map((attendance.data?.sessions ?? []).map((s) => [s.scheduleId, s])), [attendance.data]);
  const today = todayIst();

  const rosterColumns: DataTableColumn<RosterEntryDto>[] = [
    {
      key: 'learner',
      header: 'Learner',
      cell: (r, i) => {
        const name = learnerName(r.learner);
        return name ? (
          <span className="font-medium text-ink">{name}</span>
        ) : (
          <span className="flex min-w-0 flex-col">
            <span className="text-ink">Learner {i + 1}</span>
            <span className="text-body-sm text-ink-muted">Details shared after acceptance</span>
          </span>
        );
      },
    },
    { key: 'contact', header: 'Contact', hideBelow: 'md', cell: (r) => contactOf(r.learner) },
    { key: 'needs', header: 'Accessibility Needs', hideBelow: 'lg', cell: (r) => needsOf(r.learner) },
    {
      key: 'rate',
      header: 'Attendance',
      align: 'end',
      hideBelow: 'sm',
      cell: (r) => {
        const row = rateBy.get(r.enrollmentId);
        return row?.rate != null ? `${formatPercent(row.rate, 0)} (${row.attended}/${row.sessionsMarked})` : '—';
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusBadge status={r.status} />
          {r.status === 'Waitlisted' && r.waitlistRank ? <span className="font-mono text-data text-ink-muted">#{r.waitlistRank}</span> : null}
        </span>
      ),
    },
  ];

  const counts = roster.data?.counts;
  const batch = roster.data?.batchSize ?? allocation.seats.batchSize;

  return (
    <>
      <PanelGrid columns={3}>
        <Panel>
          <StatCard
            label="Accepted Learners"
            icon="users"
            value={formatNumber(counts?.accepted ?? allocation.seats.accepted)}
            loading={roster.isPending}
            footnote={
              <>
                of <strong>{formatNumber(batch)}</strong> seats
              </>
            }
          />
        </Panel>
        <Panel>
          <StatCard
            label="Attendance Rate"
            icon="list-checks"
            value={attendance.data?.attendanceRate != null ? formatPercent(attendance.data.attendanceRate) : '—'}
            loading={attendance.isPending}
            footnote={
              <>
                across <strong>{formatNumber(attendance.data?.sessionsHeld ?? 0)}</strong> sessions held
              </>
            }
          />
        </Panel>
        <Panel>
          <StatCard
            label="Average Rating"
            icon="star"
            value={feedback.data?.averageRating != null ? `${feedback.data.averageRating.toFixed(2)} / 5` : '—'}
            loading={feedback.isPending}
            footnote={
              <>
                from <strong>{formatNumber(feedback.data?.count ?? 0)}</strong> ratings
              </>
            }
          />
        </Panel>
      </PanelGrid>

      <Panel title="Roster" description="Accepted learners with the contact details they shared. Others appear without identity." className="border-b border-border">
        <div className="flex flex-col gap-4">
          {counts ? (
            <div className="flex flex-col gap-2">
              <Progress value={counts.accepted} max={Math.max(batch, 1)} label="Seats accepted" startLabel={`${counts.accepted} accepted`} endLabel={`${batch} seats`} tone="success" />
              <p className="m-0 font-mono text-data text-ink-muted tabular-nums">
                {counts.offered} offered · {counts.proposed} being arranged · {counts.waitlisted} waitlisted
              </p>
            </div>
          ) : null}
          <DataTable
            caption="Class roster"
            columns={rosterColumns}
            rows={roster.data?.entries ?? []}
            rowKey={(r) => r.enrollmentId}
            itemLabel="learners"
            loading={roster.isPending}
            error={roster.error}
            onRetry={() => void roster.refetch()}
            empty={<EmptyState icon="users" size="compact" description="No learners on this class yet. They appear as offers go out." />}
          />
        </div>
      </Panel>

      <PanelGrid columns={2}>
        <Panel title="Sessions" description="Mark who attended each session once it has taken place.">
          {schedules.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : schedules.error ? (
            <ErrorState error={schedules.error} onRetry={() => void schedules.refetch()} size="compact" />
          ) : (schedules.data ?? []).length === 0 ? (
            <EmptyState icon="calendar" size="compact" description="No sessions yet. The schedule is created when the first learner accepts." />
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {(schedules.data ?? []).map((s) => {
                const stat = sessionStats.get(s.id);
                const markable = (s.status === 'Planned' || s.status === 'Held') && s.date <= today;
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-border-strong py-2.5 last:border-b-0">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-mono text-data text-ink tabular-nums">
                        {formatDate(s.date)} {s.startTime}–{s.endTime}
                      </span>
                      <span className="text-body-sm text-ink-muted">
                        {stat && stat.marked > 0 ? `${stat.present} of ${stat.marked} present` : s.note || s.spaceName}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-2">
                      <StatusBadge status={s.status} />
                      {markable ? (
                        <Button size="sm" icon="list-checks" onClick={() => setMarking(s)} disabled={roster.isPending}>
                          {stat && stat.marked > 0 ? 'Edit' : 'Mark'}
                        </Button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Feedback" description="Ratings and comments from learners. Shown without names.">
          {feedback.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : feedback.error ? (
            <ErrorState error={feedback.error} onRetry={() => void feedback.refetch()} size="compact" />
          ) : (feedback.data?.items ?? []).length === 0 ? (
            <EmptyState icon="star" size="compact" description="No feedback yet. Learners are asked to rate the course after their sessions." />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {(feedback.data?.items ?? []).map((f) => (
                <li key={f.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={f.rating >= 4 ? 'success' : f.rating === 3 ? 'neutral' : 'warning'}>{`${f.rating} of 5`}</Badge>
                    <span className="font-mono text-data text-ink-subtle tabular-nums">{formatDate(f.createdAt)}</span>
                  </div>
                  {f.learnerName ? <span className="text-body-sm text-ink-muted">{f.learnerName}</span> : null}
                  <p className="m-0 text-body-sm text-ink">{f.comment || 'No comment.'}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PanelGrid>

      <AttendanceDialog
        session={marking}
        learners={accepted}
        previous={marking ? sessionStats.get(marking.id)?.records : null}
        onClose={() => setMarking(null)}
        allocationId={id}
      />
    </>
  );
}

/** /learners (Course Provider, Administrator): roster, attendance and feedback per allocation. */
export function LearnersView({ initialAllocationId }: { initialAllocationId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const allocations = useQuery({
    queryKey: learnerKeys.allocations,
    queryFn: async () => {
      const d = await apiGet<{ items: AllocationListItemDto[] }>('/api/allocations', { pageSize: 200 });
      return d.items.filter((a) => !HIDDEN_ALLOCATION_STATUSES.includes(a.status));
    },
  });
  const [picked, setPicked] = useState<string | undefined>(initialAllocationId);
  const list = allocations.data ?? [];
  const selected = list.find((a) => a.id === picked) ?? list[0];

  const header = (
    <PageHeader
      title="Learners"
      description="Your class rosters, session attendance and learner feedback."
      actions={
        list.length > 0 ? (
          <Select
            aria-label="Choose a class"
            className="w-full sm:w-80"
            value={selected?.id ?? ''}
            options={list.map((a) => ({ value: a.id, label: `${a.courseTitle} · ${a.spaceName} · ${a.sessionLabel}` }))}
            onChange={(e) => {
              setPicked(e.target.value);
              router.replace(`${pathname}?allocationId=${e.target.value}`, { scroll: false });
            }}
          />
        ) : null
      }
      meta={selected ? <StatusBadge status={selected.status} /> : null}
    />
  );

  if (allocations.isPending) {
    return (
      <>
        {header}
        <PanelGrid columns={3}>
          {['Accepted Learners', 'Attendance Rate', 'Average Rating'].map((label) => (
            <Panel key={label}>
              <StatCard label={label} loading />
            </Panel>
          ))}
        </PanelGrid>
      </>
    );
  }
  if (allocations.error) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState error={allocations.error} onRetry={() => void allocations.refetch()} />
        </Panel>
      </>
    );
  }
  if (!selected) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            icon="users"
            description="No confirmed classes yet. Learners appear here once a space approves your class and you confirm it."
            action={<Button href="/allocations">View Assigned Spaces</Button>}
          />
        </Panel>
      </>
    );
  }
  return (
    <>
      {header}
      <AllocationWorkspace key={selected.id} allocation={selected} />
    </>
  );
}
