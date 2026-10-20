'use client';

import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, fieldErrors, type Paged } from '@/lib/api';
import { DAY_LONG } from '@/lib/domain';
import { OVERRIDE_ACTIONS } from '@/schemas/allocation';
import { FormCheckbox, FormSelect, FormTextarea, applyServerErrors, timeOptions } from '@/components/forms';
import { Alert, Button, Dialog, useToast } from '@/components/ui';
import { allocationKeys, type AllocationDetailDto } from './allocation-hooks';

const ACTION_LABEL: Record<(typeof OVERRIDE_ACTIONS)[number], string> = {
  approve: 'Approve on behalf of the space',
  confirm: 'Confirm on behalf of the provider',
  reject: 'Reject this allocation',
  cancel: 'Cancel this allocation',
  move: 'Move to another space or session',
};

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const OverrideForm = z
  .object({
    action: z.enum(OVERRIDE_ACTIONS, { message: 'Choose an action' }),
    note: z.string().trim().min(3, 'Explain the override in a few words').max(1000),
    spaceId: z.string().optional(),
    changeSession: z.boolean(),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string(),
    endTime: z.string(),
  })
  .refine((v) => v.action !== 'move' || !v.changeSession || toMin(v.endTime) > toMin(v.startTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });
type OverrideFormValues = z.infer<typeof OverrideForm>;

interface SpaceOption {
  id: string;
  name: string;
  areaName: string | null;
}

/** Administrator override (approve | confirm | reject | cancel | move). The note is required and audited. */
export function OverrideDialog({ allocation, open, onClose }: { allocation: AllocationDetailDto; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const defaults: OverrideFormValues = {
    action: 'approve',
    note: '',
    spaceId: allocation.spaceId,
    changeSession: false,
    dayOfWeek: allocation.session.dayOfWeek,
    startTime: allocation.session.startTime,
    endTime: allocation.session.endTime,
  };
  const { control, handleSubmit, setError, reset, formState } = useForm<OverrideFormValues>({
    resolver: zodResolver(OverrideForm),
    defaultValues: defaults,
  });
  const action = useWatch({ control, name: 'action' });
  const changeSession = useWatch({ control, name: 'changeSession' });

  useEffect(() => {
    if (open) reset(defaults);
    // reset only when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const spaces = useQuery({
    queryKey: ['spaces', 'override-options'],
    queryFn: () => apiGet<Paged<SpaceOption>>('/api/spaces', { pageSize: 200 }),
    enabled: open && action === 'move',
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (body: unknown) => apiSend<AllocationDetailDto>('POST', `/api/allocations/${allocation.id}/override`, body),
    onSuccess: (data) => {
      qc.setQueryData(allocationKeys.detail(allocation.id), data);
      void qc.invalidateQueries({ queryKey: allocationKeys.all });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Override applied');
      onClose();
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    const move = v.action === 'move';
    const spaceId = move && v.spaceId && v.spaceId !== allocation.spaceId ? v.spaceId : undefined;
    const session = move && v.changeSession ? { dayOfWeek: v.dayOfWeek, startTime: v.startTime, endTime: v.endTime } : undefined;
    if (move && !spaceId && !session) {
      setError('spaceId', { type: 'manual', message: 'Choose another space, a new session, or both' });
      return;
    }
    try {
      await mutation.mutateAsync({ action: v.action, note: v.note, spaceId, session });
    } catch (err) {
      applyServerErrors(setError, err);
      const sessionError = fieldErrors(err).session;
      if (sessionError) setError('startTime', { type: 'server', message: sessionError });
    }
  });

  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;
  const times = timeOptions(30).map((t) => ({ value: t, label: t }));
  const spaceOptions = (spaces.data?.items ?? []).map((s) => ({
    value: s.id,
    label: s.id === allocation.spaceId ? `${s.name} (current)` : s.areaName ? `${s.name}, ${s.areaName}` : s.name,
  }));
  if (!spaceOptions.some((o) => o.value === allocation.spaceId)) {
    spaceOptions.unshift({ value: allocation.spaceId, label: `${allocation.spaceName} (current)` });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!formState.isSubmitting}
      title="Override Allocation"
      description="Overrides skip the usual approvals. Every override is recorded in the audit log with your note."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button variant={action === 'cancel' || action === 'reject' ? 'danger' : 'primary'} type="submit" form="override-form" loading={formState.isSubmitting}>
            Apply Override
          </Button>
        </>
      }
    >
      <form id="override-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
        <FormSelect control={control} name="action" label="Action" required options={OVERRIDE_ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] }))} />
        {action === 'move' ? (
          <>
            <FormSelect
              control={control}
              name="spaceId"
              label="Space"
              hint={spaces.isPending ? 'Loading spaces.' : 'Smart Allocation re-checks the target space before moving.'}
              options={spaceOptions}
            />
            <FormCheckbox control={control} name="changeSession" label="Change the session" description="Move the class to another day or time." />
            {changeSession ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FormSelect control={control} name="dayOfWeek" label="Day" parse={Number} options={DAY_LONG.map((d, i) => ({ value: String(i), label: d }))} />
                <FormSelect control={control} name="startTime" label="Start" options={times} />
                <FormSelect control={control} name="endTime" label="End" options={times} />
              </div>
            ) : null}
          </>
        ) : null}
        <FormTextarea control={control} name="note" label="Note" required rows={3} maxLength={1000} placeholder="Why are you overriding this allocation?" />
      </form>
    </Dialog>
  );
}
