'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { applyServerErrors, FormInput, FormTextarea } from '@/components/forms';
import { Alert, Button, DataTable, Dialog, EmptyState, IconButton, Panel, useToast, type DataTableColumn } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api';
import { lookupKeys } from '@/hooks/use-lookups';
import type { FacilityTypeDto } from '@/server/dto/lookup';
import { ActionConfirm } from './action-confirm';
import { deleteErrorMessage } from './admin-utils';
import { useReportSubmitting } from './use-report-submitting';

export const facilityTypeKeys = { all: ['facility-types'] as const };

// Same bounds as FacilityTypeInput; empty optional text is allowed here and dropped before sending.
const FacilityTypeForm = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  unit: z.string().trim().max(30),
  description: z.string().trim().max(500),
});
type FacilityTypeFormValues = z.infer<typeof FacilityTypeForm>;

export function FacilityTypesTab({ creating, onCreatingChange }: { creating: boolean; onCreatingChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<FacilityTypeDto | null>(null);
  const [deleting, setDeleting] = useState<FacilityTypeDto | null>(null);
  const query = useQuery({
    queryKey: facilityTypeKeys.all,
    queryFn: () => apiGet<{ items: FacilityTypeDto[]; total: number }>('/api/facility-types'),
  });
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: facilityTypeKeys.all }),
    queryClient.invalidateQueries({ queryKey: lookupKeys.all }),
  ]);

  const columns: DataTableColumn<FacilityTypeDto>[] = [
    { key: 'name', header: 'Facility Type', sortable: true, cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'unit', header: 'Unit', sortable: true, hideBelow: 'sm', cell: (r) => <span className="font-mono text-data">{r.unit}</span> },
    { key: 'description', header: 'Description', hideBelow: 'md', cell: (r) => <span className="text-ink-muted">{r.description || '—'}</span> },
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
    <Panel title="Facility Types" description="Equipment and amenities a space can list and a course can require." icon="list-checks">
      <DataTable
        caption="Facility types"
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(r) => r.id}
        searchable
        searchPlaceholder="Search facility types"
        itemLabel="facility types"
        initialSort={{ key: 'name', direction: 'asc' }}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        empty={
          <EmptyState
            icon="list-checks"
            size="compact"
            description="No facility types yet. Add the first one so spaces can list their equipment."
            action={<Button icon="plus" onClick={() => onCreatingChange(true)}>Add Facility Type</Button>}
          />
        }
      />
      <FacilityTypeDialog
        open={creating || editing !== null}
        item={editing}
        onClose={() => {
          setEditing(null);
          onCreatingChange(false);
        }}
        onSaved={async (name, isNew) => {
          await invalidate();
          toast.success(isNew ? 'Facility type added' : 'Facility type saved', { description: name });
        }}
      />
      <ActionConfirm
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete Facility Type?"
        description={deleting ? `${deleting.name} will be removed from the list. This cannot be undone.` : undefined}
        confirmLabel="Delete"
        tone="danger"
        formatError={(err) => deleteErrorMessage(err, 'facility type')}
        action={async () => {
          if (!deleting) return;
          await apiSend('DELETE', `/api/facility-types/${deleting.id}`);
          await invalidate();
          toast.success('Facility type deleted');
        }}
      />
    </Panel>
  );
}

function FacilityTypeDialog({
  open, item, onClose, onSaved,
}: {
  open: boolean;
  item: FacilityTypeDto | null;
  onClose: () => void;
  onSaved: (name: string, isNew: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item ? 'Edit Facility Type' : 'Add Facility Type'}
      description="Spaces list how many they have; courses list how many they need."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="facility-type-form" loading={busy}>
            {item ? 'Save Facility Type' : 'Add Facility Type'}
          </Button>
        </>
      }
    >
      {open ? <FacilityTypeFields key={item?.id ?? 'new'} item={item} onClose={onClose} onSaved={onSaved} onBusyChange={setBusy} /> : null}
    </Dialog>
  );
}

function FacilityTypeFields({
  item, onClose, onSaved, onBusyChange,
}: {
  item: FacilityTypeDto | null;
  onClose: () => void;
  onSaved: (name: string, isNew: boolean) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { control, handleSubmit, setError, formState } = useForm<FacilityTypeFormValues>({
    resolver: zodResolver(FacilityTypeForm),
    defaultValues: { name: item?.name ?? '', unit: item?.unit ?? '', description: item?.description ?? '' },
  });
  useReportSubmitting(formState.isSubmitting, onBusyChange);
  const onSubmit = handleSubmit(async (v) => {
    const body = { name: v.name, unit: v.unit || undefined, description: item ? v.description : v.description || undefined };
    try {
      if (item) await apiSend('PATCH', `/api/facility-types/${item.id}`, body);
      else await apiSend('POST', '/api/facility-types', body);
      await onSaved(v.name, !item);
      onClose();
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });
  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;
  return (
    <form id="facility-type-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
      <FormInput control={control} name="name" label="Name" placeholder="Projector" required />
      <FormInput control={control} name="unit" label="Unit" placeholder="units" hint="How quantities are counted, for example seats or units." optional />
      <FormTextarea control={control} name="description" label="Description" rows={3} optional />
    </form>
  );
}
