'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { applyServerErrors, FormInput, FormLocationPicker, FormSelect } from '@/components/forms';
import {
  Alert, Button, DataTable, Dialog, EmptyState, IconButton, Panel, StatusBadge, useToast, type DataTableColumn,
} from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api';
import { INCOME_GROUPS } from '@/lib/domain';
import { formatNumber } from '@/lib/format';
import { lookupKeys } from '@/hooks/use-lookups';
import { AreaInput } from '@/schemas/lookups';
import type { AreaDto } from '@/server/dto/lookup';
import { ActionConfirm } from './action-confirm';
import { deleteErrorMessage } from './admin-utils';
import { useReportSubmitting } from './use-report-submitting';

export const areaKeys = { all: ['areas'] as const };

export function AreasTab({ creating, onCreatingChange }: { creating: boolean; onCreatingChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<AreaDto | null>(null);
  const [deleting, setDeleting] = useState<AreaDto | null>(null);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: areaKeys.all,
    queryFn: () => apiGet<{ items: AreaDto[]; total: number }>('/api/areas'),
  });
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: areaKeys.all }),
    queryClient.invalidateQueries({ queryKey: lookupKeys.all }),
  ]);

  const columns: DataTableColumn<AreaDto>[] = [
    {
      key: 'name',
      header: 'Area',
      sortable: true,
      cell: (r) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-medium text-ink">{r.name}</span>
          {r.city ? <span className="text-body-sm text-ink-muted">{r.city}</span> : null}
        </div>
      ),
      searchValue: (r) => `${r.name} ${r.city}`,
    },
    {
      key: 'center',
      header: 'Centre (Lat, Lng)',
      hideBelow: 'lg',
      cell: (r) => <span className="font-mono text-data tabular-nums">{r.center[1].toFixed(4)}, {r.center[0].toFixed(4)}</span>,
    },
    { key: 'population', header: 'Population', align: 'end', sortable: true, hideBelow: 'md', cell: (r) => formatNumber(r.population) },
    { key: 'studentCount', header: 'Students', align: 'end', sortable: true, hideBelow: 'md', cell: (r) => formatNumber(r.studentCount) },
    { key: 'literacyRate', header: 'Literacy', align: 'end', sortable: true, hideBelow: 'lg', cell: (r) => `${r.literacyRate.toFixed(1)}%` },
    { key: 'incomeScore', header: 'Income Score', align: 'end', sortable: true, hideBelow: 'lg', cell: (r) => r.incomeScore.toFixed(0) },
    { key: 'incomeGroup', header: 'Income Group', sortable: true, hideBelow: 'sm' },
    {
      key: 'demandLevel',
      header: 'Demand Level',
      sortable: true,
      cell: (r) => (r.demandLevel ? <StatusBadge status={r.demandLevel} /> : <span className="text-body-sm text-ink-subtle">Not set</span>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      width: '96px',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <IconButton icon="pencil" label={`Edit ${r.name}`} onClick={() => setEditing(r)} />
          <IconButton icon="trash-2" label={`Delete ${r.name}`} onClick={() => setDeleting(r)} />
        </div>
      ),
    },
  ];

  return (
    <Panel
      title="Areas"
      description="Service areas with their centre and census figures. Demand level is set by each Smart Allocation run."
      icon="map-pin"
    >
      <DataTable
        caption="Areas"
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(r) => r.id}
        searchable
        searchPlaceholder="Search areas"
        itemLabel="areas"
        pageSize={20}
        initialSort={{ key: 'name', direction: 'asc' }}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        empty={
          <EmptyState
            icon="map-pin"
            size="compact"
            description="No areas yet. Add your first service area so learners and spaces can be placed."
            action={<Button icon="plus" onClick={() => onCreatingChange(true)}>Add Area</Button>}
          />
        }
      />
      <Dialog
        open={creating || editing !== null}
        onClose={() => {
          setEditing(null);
          onCreatingChange(false);
        }}
        size="lg"
        title={editing ? 'Edit Area' : 'Add Area'}
        description="The centre is used to snap spaces and requests to the nearest area and to show demand on the map."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                onCreatingChange(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="area-form" loading={busy}>
              {editing ? 'Save Area' : 'Add Area'}
            </Button>
          </>
        }
      >
        {creating || editing ? (
          <AreaFields
            key={editing?.id ?? 'new'}
            item={editing}
            onBusyChange={setBusy}
            onDone={async (name, isNew) => {
              await invalidate();
              toast.success(isNew ? 'Area added' : 'Area saved', { description: name });
              setEditing(null);
              onCreatingChange(false);
            }}
          />
        ) : null}
      </Dialog>
      <ActionConfirm
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete Area?"
        description={deleting ? `${deleting.name} will be removed. This cannot be undone.` : undefined}
        confirmLabel="Delete"
        tone="danger"
        formatError={(err) => deleteErrorMessage(err, 'area')}
        action={async () => {
          if (!deleting) return;
          await apiSend('DELETE', `/api/areas/${deleting.id}`);
          await invalidate();
          toast.success('Area deleted');
        }}
      />
    </Panel>
  );
}

function AreaFields({
  item, onDone, onBusyChange,
}: {
  item: AreaDto | null;
  onDone: (name: string, isNew: boolean) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { control, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(AreaInput),
    defaultValues: item
      ? {
          name: item.name,
          city: item.city || undefined,
          center: { type: 'Point' as const, coordinates: item.center },
          population: item.population,
          studentCount: item.studentCount,
          literacyRate: item.literacyRate,
          incomeScore: item.incomeScore,
          incomeGroup: item.incomeGroup,
        }
      : { name: '', city: 'Pune', population: undefined, studentCount: undefined, literacyRate: undefined, incomeScore: undefined },
  });
  useReportSubmitting(formState.isSubmitting, onBusyChange);
  const onSubmit = handleSubmit(async (v) => {
    const body = { ...v, city: v.city || undefined };
    try {
      if (item) await apiSend('PATCH', `/api/areas/${item.id}`, body);
      else await apiSend('POST', '/api/areas', body);
      await onDone(v.name, !item);
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });
  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;
  return (
    <form id="area-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormInput control={control} name="name" label="Name" placeholder="Kothrud" required />
        <FormInput control={control} name="city" label="City" placeholder="Pune" optional />
      </div>
      <FormLocationPicker control={control} name="center" label="Area Centre" hint="Click the map or type the latitude and longitude." height={240} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormInput control={control} name="population" label="Population" type="number" mono min={0} step={1} required />
        <FormInput control={control} name="studentCount" label="Students" type="number" mono min={0} step={1} required />
        <FormInput control={control} name="literacyRate" label="Literacy Rate (%)" type="number" mono min={0} max={100} step={0.1} required />
        <FormInput control={control} name="incomeScore" label="Income Score (0–100)" type="number" mono min={0} max={100} step={1} required />
        <FormSelect
          control={control}
          name="incomeGroup"
          label="Income Group"
          placeholder="Choose a group"
          options={INCOME_GROUPS.map((g) => ({ value: g, label: g }))}
          required
        />
        {item ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-body-sm font-medium text-ink">Demand Level</span>
            <div className="flex h-control-md items-center gap-2">
              {item.demandLevel ? <StatusBadge status={item.demandLevel} /> : <span className="text-body-sm text-ink-subtle">Not set yet</span>}
              <span className="text-body-sm text-ink-muted">Set by Smart Allocation.</span>
            </div>
          </div>
        ) : null}
      </div>
    </form>
  );
}
