'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { Alert, Button, Field, Input, PageHeader, Panel, PanelGrid, StatusBadge, useConfirm, useToast } from '@/components/ui';
import { FormInput, FormRadioGroup, FormSelect, FormWindowEditor, applyServerErrors } from '@/components/forms';
import { offeringKeys } from '@/components/spaces/space-keys';
import { useLookups } from '@/hooks/use-lookups';
import { ApiError, apiGet, apiSend, type Paged } from '@/lib/api';
import { AUDIENCES, OFFERING_STATUSES, type OfferingStatus } from '@/lib/domain';
import { OfferingInput, PROVIDER_OFFERING_STATUSES } from '@/schemas/offering';
import type { CourseDto } from '@/server/dto/course';
import type { OfferingDto } from '@/server/dto/offering';
import { OfferingAllocations } from './offering-allocations';

type FormIn = z.input<typeof OfferingInput>;

type FormOut = z.output<typeof OfferingInput>;

const STATUS_HELP: Record<OfferingStatus, string> = {
  Draft: 'Only you can see it. Smart Allocation ignores it.',
  Open: 'Visible to learners and considered by Smart Allocation.',
  Allocated: 'A space and time have been agreed.',
  Active: 'Classes are running.',
  Completed: 'The course has finished.',
  Cancelled: 'Withdrawn. Any held seats are released.',
};

const LOCKED: readonly OfferingStatus[] = ['Allocated', 'Active'];

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
/** YYYY-MM-DD in India time (the API stores instants). */
const isoDay = (d: string | Date) => dayFmt.format(new Date(d));
const today = () => isoDay(new Date());

function toDefaults(o?: OfferingDto, courseId?: string): FormIn {
  if (!o) {
    return {
      courseId: courseId ?? '',
      audience: 'Adults',
      batchSize: 20,
      sessionMinutes: 120,
      durationWeeks: 8,
      startDate: today(),
      targetAreaId: undefined,
      windows: [],
      maxRentPerHour: undefined,
      feePerMonth: undefined,
      status: 'Open',
    };
  }
  return {
    courseId: o.courseId,
    audience: o.audience,
    batchSize: o.batchSize,
    sessionMinutes: o.sessionMinutes,
    durationWeeks: o.durationWeeks,
    startDate: isoDay(o.startDate),
    targetAreaId: o.targetAreaId ?? undefined,
    windows: o.windows,
    maxRentPerHour: o.maxRentPerHour ?? undefined,
    feePerMonth: o.feePerMonth ?? undefined,
    status: o.status,
  };
}

/** Create or edit an offering (provider owner or Administrator). */
export function OfferingForm({ offering, isAdmin, initialCourseId }: { offering?: OfferingDto; isAdmin: boolean; initialCourseId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const lookups = useLookups();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editing = Boolean(offering);
  const current = offering?.status;
  const locked = !isAdmin && current !== undefined && LOCKED.includes(current);
  const completed = !isAdmin && current === 'Completed';
  const courses = useQuery({
    queryKey: ['courses', 'options', { mine: !isAdmin }],
    queryFn: () => apiGet<Paged<CourseDto>>('/api/courses', { mine: isAdmin ? undefined : 1, pageSize: 200 }),
    enabled: !editing,
  });
  const { control, handleSubmit, setError, getValues, formState } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(OfferingInput),
    defaultValues: toDefaults(offering, initialCourseId),
    mode: 'onTouched',
  });
  const sessionMinutes = useWatch({ control, name: 'sessionMinutes' });
  const statusOptions = useMemo(() => {
    const allowed: readonly OfferingStatus[] = isAdmin
      ? OFFERING_STATUSES
      : locked
        ? [current!, 'Cancelled']
        : completed
          ? ['Completed']
          : PROVIDER_OFFERING_STATUSES;
    return allowed.map((s) => ({ value: s, label: s, description: STATUS_HELP[s] }));
  }, [isAdmin, locked, completed, current]);

  const onSubmit = handleSubmit(async (values) => {
    const body = {
      ...values,
      targetAreaId: values.targetAreaId ?? null,
      maxRentPerHour: values.maxRentPerHour ?? null,
      feePerMonth: values.feePerMonth ?? null,
    };
    try {
      if (editing) {
        const { courseId: _courseId, ...patch } = body;
        // Providers on a locked offering may only cancel it.
        const payload = locked ? { status: values.status } : completed ? {} : patch;
        if (!isAdmin && values.status === current) delete (payload as { status?: unknown }).status;
        await apiSend<OfferingDto>('PATCH', `/api/offerings/${offering!.id}`, payload);
      } else {
        const saved = await apiSend<OfferingDto>('POST', '/api/offerings', body);
        await qc.invalidateQueries({ queryKey: offeringKeys.all });
        toast.success('Offering saved');
        router.push(`/offerings/${saved.id}`);
        return;
      }
      await qc.invalidateQueries({ queryKey: offeringKeys.all });
      toast.success('Offering saved');
      router.push('/offerings');
    } catch (err) {
      applyServerErrors(setError, err);
    }
  }, () => {
    if (!getValues('courseId')) setError('courseId', { type: 'required', message: 'Choose a course.' });
  });

  const remove = useMutation({
    mutationFn: () => apiSend('DELETE', `/api/offerings/${offering!.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: offeringKeys.all });
      toast.success('Offering deleted');
      router.push('/offerings');
    },
    onError: (err) =>
      setDeleteError(
        err instanceof ApiError && err.status === 409
          ? 'This offering has a booked space. Set its status to Cancelled instead, which releases the space and any held seats.'
          : err instanceof Error
            ? err.message
            : 'The offering could not be deleted. Try again.',
      ),
  });

  const onDelete = async () => {
    setDeleteError(null);
    if (await confirm({ title: 'Delete Offering?', description: `${offering?.title ?? 'This offering'} will be removed. This cannot be undone.`, confirmLabel: 'Delete Offering', tone: 'danger' })) {
      remove.mutate();
    }
  };

  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;

  const fieldsDisabled = locked || completed;
  const areaOptions = (lookups.data?.areas ?? []).map((a) => ({ value: a.id, label: a.name }));

  return (
    <>
      {dialog}
      <PageHeader
        title={editing ? offering!.title : 'Add Offering'}
        description={editing ? 'Update the schedule, seats and fees for this offering.' : 'Schedule a course so Smart Allocation can find it a space and learners.'}
        meta={current ? <StatusBadge status={current} /> : undefined}
        actions={
          editing ? (
            <Button variant="danger" icon="trash-2" onClick={onDelete} loading={remove.isPending}>Delete Offering</Button>
          ) : undefined
        }
      />
      <form onSubmit={onSubmit} noValidate className="flex flex-col">
        {rootError || deleteError || locked || completed ? (
          <div className="flex flex-col gap-2 px-4 pt-4 lg:px-6">
            {locked ? (
              <Alert tone="info" title="Offering Is Underway">
                This offering is {current === 'Active' ? 'running' : 'allocated to a space'}, so its details are locked. You can still cancel it, which releases the space and notifies learners.
              </Alert>
            ) : null}
            {completed ? <Alert tone="neutral" title="Offering Completed">A completed offering cannot be changed.</Alert> : null}
            {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
            {deleteError ? <Alert tone="warning" title="Offering Not Deleted">{deleteError}</Alert> : null}
          </div>
        ) : null}
        <PanelGrid columns={1}>
          <Panel title="Course and Audience" description="What is taught, to whom and where.">
            <fieldset disabled={fieldsDisabled} className="m-0 grid min-w-0 gap-4 border-0 p-0 md:grid-cols-2">
              {editing ? (
                <Field label="Course" hint="The course of an offering cannot change.">
                  <Input value={offering!.title} readOnly />
                </Field>
              ) : (
                <FormSelect
                  control={control}
                  name="courseId"
                  label="Course"
                  required
                  placeholder={courses.isPending ? 'Loading courses' : (courses.data?.items.length ?? 0) === 0 ? 'Add a course first' : 'Choose a course'}
                  options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: isAdmin && c.providerName ? `${c.title} (${c.providerName})` : c.title }))}
                />
              )}
              <FormSelect control={control} name="audience" label="Audience" options={AUDIENCES.map((a) => ({ value: a, label: a }))} />
              <FormSelect
                control={control}
                name="targetAreaId"
                label="Target Area"
                optional
                placeholder="Any area"
                options={areaOptions}
                hint="Smart Allocation prefers spaces and learners near this area."
              />
              <FormInput control={control} name="batchSize" label="Batch Size" type="number" min={1} max={1000} mono required hint="Seats per batch." />
            </fieldset>
          </Panel>
          <Panel title="Schedule" description="When the course runs and how long each session lasts.">
            <fieldset disabled={fieldsDisabled} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
              <div className="grid gap-4 md:grid-cols-3">
                <FormInput control={control} name="startDate" label="Start Date" type="date" mono required />
                <FormInput control={control} name="durationWeeks" label="Duration (Weeks)" type="number" min={1} max={104} mono required />
                <FormInput
                  control={control}
                  name="sessionMinutes"
                  label="Session Length (Minutes)"
                  type="number"
                  min={30}
                  max={480}
                  step={15}
                  mono
                  required
                  hint="Must fit inside at least one preferred window."
                />
              </div>
              <FormWindowEditor
                control={control}
                name="windows"
                label="Preferred Windows"
                hint={`Times that suit the course. Leave empty to accept any slot${typeof sessionMinutes === 'number' && sessionMinutes > 0 ? ` long enough for a ${sessionMinutes}-minute session` : ''}.`}
              />
            </fieldset>
          </Panel>
          <Panel title="Money" description="What you will pay for a space and what learners pay you.">
            <fieldset disabled={fieldsDisabled} className="m-0 grid min-w-0 gap-4 border-0 p-0 md:grid-cols-2">
              <FormInput control={control} name="maxRentPerHour" label="Max Rent per Hour (₹)" type="number" min={0} mono optional hint="Leave blank for no limit." />
              <FormInput control={control} name="feePerMonth" label="Fee per Month (₹)" type="number" min={0} mono optional hint="Leave blank or enter 0 for a free course." />
            </fieldset>
          </Panel>
          <Panel title="Status" description={isAdmin ? 'Administrators may set any status.' : 'Allocated, Active and Completed are set by Smart Allocation and the schedule.'}>
            <fieldset disabled={completed} className="m-0 min-w-0 border-0 p-0">
              <FormRadioGroup control={control} name="status" label="Status" options={statusOptions} />
            </fieldset>
          </Panel>
          {offering ? <OfferingAllocations offeringId={offering.id} batchSize={offering.batchSize} /> : null}
        </PanelGrid>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3 lg:px-6">
          {Object.keys(formState.errors).length > 0 && formState.isSubmitted ? (
            <p className="m-0 mr-auto text-body-sm text-danger-ink">Some fields need attention.</p>
          ) : null}
          <Button variant="ghost" href="/offerings">Cancel</Button>
          <Button variant="primary" type="submit" icon="check" loading={formState.isSubmitting} disabled={completed}>
            {editing ? 'Save Offering' : 'Add Offering'}
          </Button>
        </div>
      </form>
    </>
  );
}
