'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { applyServerErrors, FormInput, FormSwitch, FormTextarea } from '@/components/forms';
import {
  Alert, Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, Panel, PanelGrid, SearchField, Skeleton, Tag, useToast,
} from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api';
import { NOTIFICATION_TYPES, ROLE_LABEL, ROLES, type Role } from '@/lib/domain';
import { formatDateTime } from '@/lib/format';
import { TemplateUpsertInput } from '@/schemas/template';
import type { TemplateDto } from '@/server/dto/notification';
import { humanize } from './admin-utils';
import { useReportSubmitting } from './use-report-submitting';

export const templateKeys = { all: ['notification-templates'] as const };

const FORM_ID = 'template-form';

/** Sample values for the live preview. Unknown placeholders show their name in brackets. */
const SAMPLE: Record<string, string> = {
  recipientName: 'Asha Kulkarni',
  learnerName: 'Asha Kulkarni',
  providerName: 'Bright Minds Academy',
  spaceGiverName: 'Kothrud Community Trust',
  courseTitle: 'Spoken English for Beginners',
  offeringTitle: 'Spoken English for Beginners',
  categoryName: 'Spoken English',
  spaceName: 'Kothrud Community Hall',
  areaName: 'Kothrud',
  anchorArea: 'Kothrud',
  areaCount: '4',
  requestCount: '38',
  session: 'Sat 10:00–12:00',
  schedule: 'Sat 10:00–12:00',
  freeSlot: 'Mon 18:00–20:00 (60 seats)',
  seats: '60',
  headcount: '24',
  date: '24 Oct 2026',
  startDate: '24 Oct 2026',
  expiresAt: '27 Oct 2026, 18:00',
  hours: '24',
  facilityName: 'Projector',
  affectedQuantity: '1',
  reason: 'The space is closed for repairs',
  runId: 'run 2026-10-18',
  error: 'Run lock timed out',
  name: 'Asha Kulkarni',
  email: 'asha@example.org',
  role: 'Learner',
  position: '2',
  distanceKm: '2.4 km',
  feePerMonth: '₹1,500',
  affectedCount: '2',
  approvalNote: 'The space approves classes automatically.',
  batchSize: '24',
  change: 'moved to Sun 10:00–12:00',
  distance: '2.4 km',
  newSpaceName: 'Aundh Library Hall',
  oldSpaceName: 'Kothrud Community Hall',
  quantity: '1',
  retryNote: 'It will retry automatically.',
  roleLabel: 'Course Provider',
  runRef: 'Run of 18 Oct 2026, 09:30',
  seatsTaken: '18',
  sessionCount: '12',
  suggestionCount: '3',
};

function render(template: string): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, name: string) => SAMPLE[name] ?? `[${humanize(name).toLowerCase()}]`);
}

const typeOrder = (t: string) => {
  const i = (NOTIFICATION_TYPES as readonly string[]).indexOf(t);
  return i === -1 ? NOTIFICATION_TYPES.length : i;
};
const roleOrder = (r: string) => {
  const i = (ROLES as readonly string[]).indexOf(r);
  return i === -1 ? ROLES.length : i;
};
const roleLabel = (r: string) => ROLE_LABEL[r as Role] ?? r;

export function TemplatesScreen() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TemplateDto | null>(null);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: templateKeys.all,
    queryFn: () => apiGet<{ items: TemplateDto[] }>('/api/notification-templates'),
  });

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = (query.data?.items ?? []).filter(
      (t) => !q || t.type.toLowerCase().includes(q) || humanize(t.type).toLowerCase().includes(q) || t.titleTemplate.toLowerCase().includes(q) || roleLabel(t.role).toLowerCase().includes(q),
    );
    const map = new Map<string, TemplateDto[]>();
    for (const t of items) map.set(t.type, [...(map.get(t.type) ?? []), t]);
    return [...map.entries()]
      .sort(([a], [b]) => typeOrder(a) - typeOrder(b) || a.localeCompare(b))
      .map(([type, list]) => ({ type, list: list.sort((a, b) => roleOrder(a.role) - roleOrder(b.role)) }));
  }, [query.data, search]);

  const total = query.data?.items.length ?? 0;
  const customised = query.data?.items.filter((t) => t.customised).length ?? 0;

  let body;
  if (query.isPending) {
    body = (
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  } else if (query.isError) {
    body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  } else if (total === 0) {
    body = <EmptyState icon="bell" description="No notification templates are defined yet. Run the seed to load the defaults." />;
  } else if (groups.length === 0) {
    body = <EmptyState icon="search" size="compact" description={`No templates match “${search}”.`} action={<Button variant="ghost" onClick={() => setSearch('')}>Clear Search</Button>} />;
  } else {
    body = (
      <div className="flex flex-col gap-5">
        {groups.map(({ type, list }) => (
          <section key={type} aria-labelledby={`tpl-${type}`} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 id={`tpl-${type}`} className="m-0 text-heading text-ink">
                {humanize(type)}
              </h3>
              <span className="font-mono text-delta text-ink-subtle">{type}</span>
            </div>
            <ul className="m-0 list-none overflow-hidden rounded-lg border border-border p-0">
              {list.map((t) => (
                <li key={`${t.type}-${t.role}`} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag tone="neutral">{roleLabel(t.role)}</Tag>
                      {t.customised ? <Badge tone="accent">Customised</Badge> : <Badge tone="neutral">Default</Badge>}
                      {t.sendEmail ? <Badge tone="info">Email</Badge> : null}
                    </div>
                    <p className="m-0 truncate text-body text-ink">{t.titleTemplate}</p>
                    <p className="m-0 line-clamp-2 text-body-sm text-ink-muted">{t.bodyTemplate}</p>
                  </div>
                  <div className="flex flex-none items-center gap-3">
                    {t.updatedAt ? <span className="hidden font-mono text-delta text-ink-subtle md:inline">{formatDateTime(t.updatedAt)}</span> : null}
                    <Button size="sm" icon="pencil" onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Notification Templates"
        description="The words each role sees for every notification. Changes apply to the next notification sent."
        meta={
          query.data ? (
            <span className="font-mono text-data text-ink-muted">
              {total} templates, {customised} customised
            </span>
          ) : null
        }
      />
      <PanelGrid columns={1}>
        <Panel
          title="Templates by Notification"
          description="Placeholders in double braces are filled in when the notification is sent."
          icon="bell"
          actions={total > 0 ? <SearchField id="template-search" size="sm" placeholder="Search templates" value={search} onChange={(e) => setSearch(e.target.value)} /> : null}
        >
          {body}
        </Panel>
      </PanelGrid>
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        size="lg"
        title="Edit Template"
        description={editing ? `${humanize(editing.type)} for ${roleLabel(editing.role)}.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={FORM_ID} loading={busy}>
              Save Template
            </Button>
          </>
        }
      >
        {editing ? (
          <TemplateFields
            key={`${editing.type}-${editing.role}`}
            template={editing}
            onBusyChange={setBusy}
            onSaved={async () => {
              await queryClient.invalidateQueries({ queryKey: templateKeys.all });
              toast.success('Template saved');
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function TemplateFields({
  template, onSaved, onBusyChange,
}: {
  template: TemplateDto;
  onSaved: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { control, handleSubmit, setError, setValue, getValues, formState } = useForm({
    resolver: zodResolver(TemplateUpsertInput),
    defaultValues: {
      type: template.type as TemplateUpsertInput['type'],
      role: template.role as TemplateUpsertInput['role'],
      titleTemplate: template.titleTemplate,
      bodyTemplate: template.bodyTemplate,
      sendEmail: template.sendEmail,
    },
  });
  useReportSubmitting(formState.isSubmitting, onBusyChange);
  const title = useWatch({ control, name: 'titleTemplate' }) ?? '';
  const body = useWatch({ control, name: 'bodyTemplate' }) ?? '';
  const placeholders = template.placeholders.includes('recipientName') ? template.placeholders : ['recipientName', ...template.placeholders];

  const onSubmit = handleSubmit(async (v) => {
    try {
      await apiSend('PATCH', '/api/notification-templates', v);
      await onSaved();
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });

  const insert = (name: string) => {
    const current = getValues('bodyTemplate') ?? '';
    setValue('bodyTemplate', `${current}${current && !current.endsWith(' ') ? ' ' : ''}{{${name}}}`, { shouldDirty: true, shouldValidate: true });
  };

  const resetToDefault = () => {
    const d = template.defaultTemplate;
    if (!d) return;
    setValue('titleTemplate', d.titleTemplate, { shouldDirty: true, shouldValidate: true });
    setValue('bodyTemplate', d.bodyTemplate, { shouldDirty: true, shouldValidate: true });
    setValue('sendEmail', d.sendEmail, { shouldDirty: true });
  };

  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
        <FormInput control={control} name="titleTemplate" label="Title" maxLength={200} required />
        <FormTextarea control={control} name="bodyTemplate" label="Message" rows={6} maxLength={2000} required />
        <div className="flex flex-col gap-2">
          <span className="text-label uppercase text-ink-muted">Placeholders</span>
          <div className="flex flex-wrap gap-1.5">
            {placeholders.map((p) => (
              <Button key={p} size="sm" variant="secondary" type="button" onClick={() => insert(p)} aria-label={`Insert ${p} into the message`}>
                <span className="font-mono">{`{{${p}}}`}</span>
              </Button>
            ))}
          </div>
          <p className="m-0 text-body-sm text-ink-muted">Click a placeholder to add it to the end of the message. Unknown placeholders send as blank text.</p>
        </div>
        <FormSwitch control={control} name="sendEmail" label="Also send by email" hint="Only when email is on in Settings and the person allows email." />
        {template.defaultTemplate ? (
          <div>
            <Button size="sm" variant="ghost" type="button" icon="refresh-cw" onClick={resetToDefault}>
              Reset to Default
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-label uppercase text-ink-muted">Preview</span>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-sunken p-1" aria-live="polite">
          <div className="flex flex-col gap-1 rounded-md bg-surface p-3 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label uppercase text-ink-muted">{roleLabel(template.role)}</span>
              <span className="font-mono text-delta text-ink-subtle">Just now</span>
            </div>
            <p className="m-0 text-body font-medium text-ink">{render(title) || 'Title'}</p>
            <p className="m-0 whitespace-pre-line text-body-sm text-ink-muted">{render(body) || 'Message'}</p>
          </div>
        </div>
        <p className="m-0 text-body-sm text-ink-muted">Shown with sample values.</p>
      </div>
    </form>
  );
}
