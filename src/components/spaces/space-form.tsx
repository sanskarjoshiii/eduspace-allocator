'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  Alert, Button, Checkbox, Field, KeyValueList, PageHeader, Panel, PanelGrid, Select, useConfirm, useToast,
} from '@/components/ui';
import { FormInput, FormLocationPicker, FormRadioGroup, FormSwitch, FormTextarea, applyServerErrors } from '@/components/forms';
import { useLookups } from '@/hooks/use-lookups';
import { ApiError, apiGet, apiSend, type Paged } from '@/lib/api';
import { AUDIENCES, type Audience } from '@/lib/domain';
import { SpaceInput } from '@/schemas/space';
import type { SpaceFullDto } from '@/server/dto/space';
import { FormFacilitiesEditor } from './facilities-editor';
import { categoryTreeOptions, lookupCategories, lookupFacilityTypes } from './lookup-helpers';
import { PhotoUploader, type UploadedPhoto } from './photo-uploader';
import { FormSlotEditor } from './slot-editor';
import { spaceKeys } from './space-keys';

type FormIn = z.input<typeof SpaceInput>;
type FormOut = z.output<typeof SpaceInput>;

const APPROVAL_OPTIONS = [
  { value: 'auto', label: 'Auto', description: 'Bookings proposed by Smart Allocation are approved straight away. Best when the space is free at the listed times.' },
  { value: 'manual', label: 'Manual', description: 'You review and approve each proposed booking before the course provider can confirm it.' },
] as const;

function toDefaults(s?: SpaceFullDto): FormIn {
  if (!s) {
    return {
      name: '',
      description: '',
      address: '',
      location: undefined as unknown as FormIn['location'],
      isActive: true,
      seatCapacity: undefined as unknown as number,
      photos: [],
      facilities: [],
      slots: [],
      policy: { allowedCategoryIds: [], allowedAudiences: [], rentPerHour: 0, approvalMode: 'auto', rules: '' },
    };
  }
  return {
    name: s.name,
    description: s.description,
    address: s.address,
    location: { type: 'Point', coordinates: s.location },
    isActive: s.isActive,
    seatCapacity: s.seatCapacity,
    photos: s.photos,
    facilities: s.facilities,
    slots: s.slots.map((sl) => ({ ...(sl.id ? { id: sl.id } : {}), dayOfWeek: sl.dayOfWeek, startTime: sl.startTime, endTime: sl.endTime, isBlocked: sl.isBlocked })),
    policy: {
      allowedCategoryIds: s.policy.allowedCategoryIds,
      allowedAudiences: s.policy.allowedAudiences,
      rentPerHour: s.policy.rentPerHour,
      approvalMode: s.policy.approvalMode,
      rules: s.policy.rules,
    },
  };
}

interface UserRow { id: string; name: string; email: string }

/** Create or edit a space (owner or Administrator). */
export function SpaceForm({ space, isAdmin }: { space?: SpaceFullDto; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const lookups = useLookups();
  const categories = useMemo(() => categoryTreeOptions(lookupCategories(lookups.data)), [lookups.data]);
  const facilityTypes = lookupFacilityTypes(lookups.data);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editing = Boolean(space);

  const owners = useQuery({
    queryKey: ['users', { role: 'SpaceGiver', status: 'Active' }],
    queryFn: () => apiGet<Paged<UserRow>>('/api/users', { role: 'SpaceGiver', status: 'Active', pageSize: 200 }),
    enabled: isAdmin && !editing,
  });

  const { control, handleSubmit, setError, getValues, formState } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(SpaceInput),
    defaultValues: toDefaults(space),
    mode: 'onTouched',
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = editing
        ? await apiSend<SpaceFullDto>('PATCH', `/api/spaces/${space!.id}`, { ...values, ownerUserId: undefined })
        : await apiSend<SpaceFullDto>('POST', '/api/spaces', values);
      await qc.invalidateQueries({ queryKey: spaceKeys.all });
      qc.invalidateQueries({ queryKey: ['map'] });
      toast.success('Space saved');
      router.push(editing ? '/spaces' : `/spaces/${saved.id}`);
    } catch (err) {
      applyServerErrors(setError, err);
    }
  }, () => {
    // Plain-language messages for fields that are simply missing.
    if (!getValues('location')) setError('location', { type: 'required', message: 'Pin the space on the map.' });
    const seats = getValues('seatCapacity');
    if (seats === undefined || Number.isNaN(seats)) setError('seatCapacity', { type: 'required', message: 'Enter the number of seats.' });
  });

  const remove = useMutation({
    mutationFn: () => apiSend('DELETE', `/api/spaces/${space!.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: spaceKeys.all });
      toast.success('Space deleted');
      router.push('/spaces');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setDeleteError('This space has booked classes (approved, confirmed, scheduled or active). Cancel or move those allocations before you delete it, or switch the space off instead.');
      } else {
        setDeleteError(err instanceof Error ? err.message : 'The space could not be deleted. Try again.');
      }
    },
  });

  const onDelete = async () => {
    setDeleteError(null);
    const ok = await confirm({
      title: 'Delete Space?',
      description: `${space?.name ?? 'This space'} and its slots will be removed. This cannot be undone.`,
      confirmLabel: 'Delete Space',
      tone: 'danger',
    });
    if (ok) remove.mutate();
  };

  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;

  return (
    <>
      {dialog}
      <PageHeader
        title={editing ? space!.name : 'Add Space'}
        description={editing ? 'Update the details, slots and policy for this space.' : 'Register a space so Smart Allocation can place classes in it.'}
        actions={
          editing ? (
            <Button variant="danger" icon="trash-2" onClick={onDelete} loading={remove.isPending}>
              Delete Space
            </Button>
          ) : undefined
        }
      />
      <form onSubmit={onSubmit} noValidate className="flex flex-col">
        {rootError || deleteError ? (
          <div className="flex flex-col gap-2 px-4 pt-4 lg:px-6">
            {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
            {deleteError ? <Alert tone="warning" title="Space Not Deleted">{deleteError}</Alert> : null}
          </div>
        ) : null}

        <PanelGrid columns={1}>
          <Panel title="Basics" description="What learners and course providers see first.">
            <div className="grid gap-4 md:grid-cols-2">
              <FormInput control={control} name="name" label="Name" required autoComplete="off" />
              <FormInput control={control} name="seatCapacity" label="Seat Capacity" type="number" min={1} mono required />
              <FormTextarea control={control} name="description" label="Description" optional rows={3} className="md:col-span-2" maxLength={4000} />
              <FormInput control={control} name="address" label="Address" optional className="md:col-span-2" autoComplete="street-address" />
              <FormSwitch control={control} name="isActive" label="Active" hint="Inactive spaces are hidden from other users and never booked." />
              {isAdmin && !editing ? (
                <Controller
                  control={control}
                  name="ownerUserId"
                  render={({ field, fieldState }) => (
                    <Field label="Owner" optional hint="The Space Giver this space belongs to. Leave blank to own it yourself." error={fieldState.error?.message}>
                      <Select
                        placeholder={owners.isPending ? 'Loading space givers' : 'Choose a space giver'}
                        options={(owners.data?.items ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || undefined)}
                        onBlur={field.onBlur}
                      />
                    </Field>
                  )}
                />
              ) : null}
            </div>
          </Panel>

          <Panel title="Location" description="Pin the entrance. The space joins the nearest area within 25 km.">
            <div className="flex flex-col gap-3">
              <FormLocationPicker control={control} name="location" label="Map Location" hint="Click the map, drag the pin or type the latitude and longitude." />
              {space ? (
                <KeyValueList items={[{ label: 'Area', value: space.areaName ?? '—' }]} />
              ) : null}
            </div>
          </Panel>

          <Panel title="Facilities" description="Smart Allocation matches course requirements against working quantities.">
            <FormFacilitiesEditor control={control} name="facilities" facilityTypes={facilityTypes} />
          </Panel>

          <Panel title="Weekly Slots" description="When the space is open for classes.">
            <FormSlotEditor control={control} name="slots" />
          </Panel>

          <Panel title="Policy" description="Who may use the space, what it costs and how bookings are approved.">
            <div className="grid gap-6 md:grid-cols-2">
              <Controller
                control={control}
                name="policy.allowedCategoryIds"
                render={({ field, fieldState }) => {
                  const value = field.value ?? [];
                  const toggle = (id: string, on: boolean) => field.onChange(on ? [...value, id] : value.filter((v) => v !== id));
                  return (
                    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" onBlur={field.onBlur}>
                      <legend className="mb-1 p-0 text-body-sm font-medium text-ink">Allowed Categories</legend>
                      <p className="m-0 -mt-1 text-body-sm text-ink-muted">Leave all unticked to allow every category.</p>
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-border p-3">
                        {categories.length === 0 ? (
                          <p className="m-0 text-body-sm text-ink-muted">{lookups.isPending ? 'Loading categories.' : 'No categories yet.'}</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {categories.map((c) => (
                              <div key={c.value} style={{ paddingLeft: `${c.depth * 20}px` }}>
                                <Checkbox
                                  id={`cat-${c.value}`}
                                  label={c.label.split(' / ').at(-1) ?? c.label}
                                  checked={value.includes(c.value)}
                                  onChange={(e) => toggle(c.value, e.target.checked)}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {fieldState.error?.message ? <p className="m-0 text-body-sm text-danger-ink">{fieldState.error.message}</p> : null}
                    </fieldset>
                  );
                }}
              />
              <div className="flex flex-col gap-5">
                <Controller
                  control={control}
                  name="policy.allowedAudiences"
                  render={({ field }) => {
                    const value = (field.value ?? []) as Audience[];
                    return (
                      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" onBlur={field.onBlur}>
                        <legend className="mb-1 p-0 text-body-sm font-medium text-ink">Allowed Audiences</legend>
                        <p className="m-0 -mt-1 text-body-sm text-ink-muted">Leave all unticked to allow everyone.</p>
                        <div className="flex flex-wrap gap-x-5 gap-y-2">
                          {AUDIENCES.map((a) => (
                            <Checkbox
                              key={a}
                              id={`aud-${a}`}
                              label={a}
                              checked={value.includes(a)}
                              onChange={(e) => field.onChange(e.target.checked ? [...value, a] : value.filter((v) => v !== a))}
                            />
                          ))}
                        </div>
                      </fieldset>
                    );
                  }}
                />
                <FormInput control={control} name="policy.rentPerHour" label="Rent per Hour (₹)" type="number" min={0} mono hint="What a course provider pays per hour. Enter 0 for free." />
                <FormRadioGroup control={control} name="policy.approvalMode" label="Approval Mode" options={APPROVAL_OPTIONS} />
              </div>
              <FormTextarea
                control={control}
                name="policy.rules"
                label="House Rules"
                optional
                rows={3}
                maxLength={2000}
                placeholder="For example: no food in the lab; leave the room as you found it."
                className="md:col-span-2"
              />
            </div>
          </Panel>

          <Panel title="Photos" description="Show the room, the entrance and the equipment.">
            <Controller
              control={control}
              name="photos"
              render={({ field }) => <PhotoUploader value={(field.value ?? []) as UploadedPhoto[]} onChange={field.onChange} />}
            />
          </Panel>
        </PanelGrid>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3 lg:px-6">
          {Object.keys(formState.errors).length > 0 && formState.isSubmitted ? (
            <p className="m-0 mr-auto text-body-sm text-danger-ink">Some fields need attention.</p>
          ) : null}
          <Button variant="ghost" href="/spaces">
            Cancel
          </Button>
          <Button variant="primary" type="submit" icon="check" loading={formState.isSubmitting}>
            {editing ? 'Save Space' : 'Add Space'}
          </Button>
        </div>
      </form>
    </>
  );
}
