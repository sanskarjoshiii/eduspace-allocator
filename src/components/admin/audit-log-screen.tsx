'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import {
  Alert, Badge, Button, EmptyState, ErrorState, Field, Icon, IconButton, Input, PageHeader, Pagination, Panel, PanelGrid, Select, Skeleton, cn,
} from '@/components/ui';
import { apiGet, type Paged } from '@/lib/api';
import { ROLE_LABEL, type Role } from '@/lib/domain';
import { formatDateTime } from '@/lib/format';
import type { AuditLogDto } from '@/server/dto/audit';
import type { UserDto } from '@/server/dto/user';
import { diffRows, diffValue, humanize, settingLabel } from './admin-utils';

const PAGE_SIZE = 25;

type AuditPage = Paged<AuditLogDto> & { facets?: { entities: string[]; actions: string[] } };

const ACTION_TONE: Record<string, 'neutral' | 'success' | 'info' | 'warning' | 'danger' | 'accent'> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
  approve: 'success',
  suspend: 'danger',
  reactivate: 'success',
  cancel: 'warning',
};

const roleLabel = (r: string) => (r in ROLE_LABEL ? ROLE_LABEL[r as Role] : r);

/** Audit log (Administrator) or own activity (Space Giver, Course Provider). PLAN 7.8. */
export function AuditLogScreen({ role }: { role: Role }) {
  const admin = role === 'Administrator';
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rangeInvalid = Boolean(from && to && from > to);

  const query = useQuery({
    queryKey: ['audit-logs', { page, entity, action, actorId, from, to }],
    queryFn: () =>
      apiGet<AuditPage>('/api/audit-logs', {
        page,
        pageSize: PAGE_SIZE,
        entity,
        action,
        actorId,
        from: from ? `${from}T00:00:00+05:30` : undefined,
        to: to ? `${to}T23:59:59.999+05:30` : undefined,
        facets: 1,
      }),
    placeholderData: keepPreviousData,
    enabled: !rangeInvalid,
  });
  const actors = useQuery({
    queryKey: ['users', 'audit-actors'],
    queryFn: () => apiGet<Paged<UserDto>>('/api/users', { pageSize: 200 }),
    enabled: admin,
    staleTime: 5 * 60_000,
  });

  const facets = query.data?.facets;
  const filtered = Boolean(entity || action || actorId || from || to);
  const setFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const clear = () =>
    setFilter(() => {
      setEntity('');
      setAction('');
      setActorId('');
      setFrom('');
      setTo('');
    });
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = query.data?.items ?? [];
  const loading = query.isPending && !rangeInvalid;
  const colCount = admin ? 6 : 5;

  return (
    <>
      <PageHeader
        title={admin ? 'Audit Logs' : 'Activity'}
        description={
          admin
            ? 'Every create, update and delete across EduSpace, with who did it and what changed.'
            : 'Changes you made and changes made to your records, newest first.'
        }
      />
      <PanelGrid columns={1}>
        <Panel title="Filters" description="Narrow the log by record, action, person and date." icon="filter">
          <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', admin ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
            <Field label="Record">
              <Select
                value={entity}
                onChange={(e) => setFilter(() => setEntity(e.target.value))}
                options={[{ value: '', label: 'All records' }, ...(facets?.entities ?? []).map((v) => ({ value: v, label: humanize(v) }))]}
              />
            </Field>
            <Field label="Action">
              <Select
                value={action}
                onChange={(e) => setFilter(() => setAction(e.target.value))}
                options={[{ value: '', label: 'All actions' }, ...(facets?.actions ?? []).map((v) => ({ value: v, label: humanize(v) }))]}
              />
            </Field>
            {admin ? (
              <Field label="Person">
                <Select
                  value={actorId}
                  onChange={(e) => setFilter(() => setActorId(e.target.value))}
                  disabled={actors.isPending}
                  options={[
                    { value: '', label: actors.isPending ? 'Loading people' : 'Everyone' },
                    ...(actors.data?.items ?? []).map((u) => ({ value: u.id, label: `${u.name} (${ROLE_LABEL[u.role]})` })),
                  ]}
                />
              </Field>
            ) : null}
            <Field label="From" error={rangeInvalid ? 'Start date must be before end date' : undefined}>
              <Input type="date" mono value={from} max={to || undefined} onChange={(e) => setFilter(() => setFrom(e.target.value))} />
            </Field>
            <Field label="To">
              <Input type="date" mono value={to} min={from || undefined} onChange={(e) => setFilter(() => setTo(e.target.value))} />
            </Field>
          </div>
          {filtered ? (
            <div className="mt-3">
              <Button size="sm" variant="ghost" icon="x" onClick={clear}>
                Clear Filters
              </Button>
            </div>
          ) : null}
        </Panel>
        <Panel
          title={admin ? 'Log Entries' : 'Your Activity'}
          description="Open an entry to see each field that changed, from the old value to the new one."
          icon="scroll-text"
        >
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="min-w-0 overflow-x-auto rounded-lg border border-border bg-surface" aria-busy={loading || undefined}>
                <table className="w-full border-collapse font-sans text-body text-ink">
                  <caption className="sr-only">{admin ? 'Audit log entries' : 'Your activity'}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="w-12 border-b border-border bg-surface-sunken px-2 py-2.5">
                        <span className="sr-only">Details</span>
                      </th>
                      <Th>When</Th>
                      <Th>Action</Th>
                      <Th>Record</Th>
                      {admin ? <Th className="max-md:hidden">Person</Th> : null}
                      <Th className="max-sm:hidden">Changes</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 6 }, (_, i) => (
                          <tr key={`sk-${i}`}>
                            {Array.from({ length: colCount }, (__, j) => (
                              <td key={j} className="border-b border-border px-4 py-3">
                                <Skeleton className="h-4 w-3/4" />
                              </td>
                            ))}
                          </tr>
                        ))
                      : null}
                    {!loading && rows.length === 0 ? (
                      <tr>
                        <td colSpan={colCount}>
                          <EmptyState
                            icon="scroll-text"
                            size="compact"
                            description={filtered ? 'No entries match these filters.' : admin ? 'No changes have been recorded yet.' : 'No activity yet. Changes you make will show here.'}
                            action={filtered ? <Button variant="ghost" onClick={clear}>Clear Filters</Button> : undefined}
                          />
                        </td>
                      </tr>
                    ) : null}
                    {!loading
                      ? rows.map((r) => {
                          const open = expanded.has(r.id);
                          const changes = diffRows(r.diff);
                          const panelId = `audit-${r.id}`;
                          return (
                            <Fragment key={r.id}>
                              <tr className="transition-colors duration-120 ease-out hover:bg-surface-sunken">
                                <td className="border-b border-border px-2 py-2 align-middle">
                                  <IconButton
                                    icon={open ? 'chevron-down' : 'chevron-right'}
                                    label={open ? 'Hide changes' : 'Show changes'}
                                    aria-expanded={open}
                                    aria-controls={panelId}
                                    onClick={() => toggle(r.id)}
                                    disabled={changes.length === 0}
                                  />
                                </td>
                                <td className="border-b border-border px-4 py-3 align-middle whitespace-nowrap">
                                  <span className="font-mono text-data tabular-nums">{formatDateTime(r.createdAt)}</span>
                                </td>
                                <td className="border-b border-border px-4 py-3 align-middle">
                                  <Badge tone={ACTION_TONE[r.action] ?? 'neutral'}>{humanize(r.action)}</Badge>
                                </td>
                                <td className="border-b border-border px-4 py-3 align-middle">
                                  <div className="flex min-w-0 flex-col">
                                    <span className="text-ink">{humanize(r.entity)}</span>
                                    {r.entityId ? <span className="font-mono text-delta text-ink-subtle">{r.entityId.slice(-8)}</span> : null}
                                  </div>
                                </td>
                                {admin ? (
                                  <td className="border-b border-border px-4 py-3 align-middle max-md:hidden">
                                    <div className="flex min-w-0 flex-col">
                                      <span className="text-ink">{r.actor.name}</span>
                                      <span className="text-body-sm text-ink-muted">{roleLabel(r.actor.role)}</span>
                                    </div>
                                  </td>
                                ) : null}
                                <td className="border-b border-border px-4 py-3 align-middle text-body-sm text-ink-muted max-sm:hidden">
                                  {changes.length === 0 ? 'No field changes' : `${changes.length} ${changes.length === 1 ? 'field' : 'fields'}`}
                                </td>
                              </tr>
                              {open ? (
                                <tr id={panelId}>
                                  <td colSpan={colCount} className="border-b border-border bg-surface-sunken px-4 py-3">
                                    <DiffList entity={r.entity} rows={changes} />
                                    {admin ? null : (
                                      <p className="m-0 mt-2 text-body-sm text-ink-muted">
                                        By {r.actor.name} ({roleLabel(r.actor.role)})
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })
                      : null}
                  </tbody>
                </table>
              </div>
              {(query.data?.total ?? 0) > PAGE_SIZE ? (
                <Pagination page={page} pageSize={PAGE_SIZE} total={query.data?.total ?? 0} itemLabel="entries" onPageChange={setPage} />
              ) : null}
              {rangeInvalid ? <Alert tone="warning">Choose a start date on or before the end date to load entries.</Alert> : null}
            </div>
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('border-b border-border bg-surface-sunken px-4 py-2.5 text-left font-mono text-label whitespace-nowrap text-ink-muted uppercase', className)}>
      {children}
    </th>
  );
}

function DiffList({ entity, rows }: { entity: string; rows: ReturnType<typeof diffRows> }) {
  const label = (field: string) => (entity === 'SystemSetting' ? field.split('.').map(settingLabel).join(' / ') : field.split('.').map(humanize).join(' / '));
  return (
    <dl className="m-0 flex flex-col gap-2">
      {rows.map((d) => (
        <div key={d.field} className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-3">
          <dt className="text-body-sm font-medium text-ink">{label(d.field)}</dt>
          <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2 font-mono text-data">
            {d.hasFrom ? (
              <>
                <span className="break-all text-ink-muted line-through decoration-border-strong">{diffValue(d.from)}</span>
                <Icon name="chevron-right" size={14} className="text-ink-subtle" title="changed to" />
              </>
            ) : null}
            <span className="break-all text-ink">{diffValue(d.to)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
