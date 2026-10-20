'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useController, type Control, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { Alert, Button, Checkbox, Panel, PanelGrid, Skeleton, useToast } from '@/components/ui';
import {
  FormCheckbox, FormInput, FormLocationPicker, FormSelect, FormTextarea, FormWindowEditor, applyServerErrors,
} from '@/components/forms';
import { useLookups } from '@/hooks/use-lookups';
import { apiSend } from '@/lib/api';
import { RequestInput } from '@/schemas/request';
import { categoryOptions, requestKeys, type RequestFullDto } from './request-utils';

type FormIn = z.input<typeof RequestInput>;
type FormOut = z.output<typeof RequestInput>;

const baseResolver = zodResolver(RequestInput) as Resolver<FormIn, unknown, FormOut>;
/** Friendlier message when no point was picked yet. */
const resolver: Resolver<FormIn, unknown, FormOut> = async (values, ctx, opts) => {
  const result = await baseResolver(values, ctx, opts);
  if (result.errors.location && !values.location) {
    result.errors.location = {
      type: 'required',
      message: 'Pick your location on the map or type its coordinates.',
    } as unknown as typeof result.errors.location;
  }
  return result;
};

function nextMonth(): string {
  const d = new Date();
  const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
  const m = ((d.getMonth() + 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function defaultsFrom(existing: RequestFullDto | undefined, categoryId: string | undefined): FormIn {
  if (existing) {
    return {
      categoryId: existing.categoryId,
      location: { type: 'Point', coordinates: existing.location },
      maxDistanceKm: existing.maxDistanceKm,
      startMonth: existing.startMonth,
      durationMonths: existing.durationMonths,
      consentShared: existing.consentShared,
      windows: existing.windows,
      requiredFacilityTypeIds: existing.requiredFacilityTypeIds,
      budgetPerMonth: existing.budgetPerMonth ?? undefined,
      notes: existing.notes,
    };
  }
  return {
    categoryId: categoryId ?? '',
    location: undefined as unknown as FormIn['location'],
    maxDistanceKm: 5,
    startMonth: nextMonth(),
    durationMonths: 3,
    consentShared: false,
    windows: [],
    requiredFacilityTypeIds: [],
    budgetPerMonth: undefined,
    notes: '',
  };
}

/** Multi-select of facility types as a checkbox group. */
function FacilityChecklist({ control, options }: { control: Control<FormIn, unknown, FormOut>; options: { id: string; name: string }[] }) {
  const { field, fieldState } = useController({ control, name: 'requiredFacilityTypeIds' });
  const selected = new Set(field.value ?? []);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    field.onChange([...next]);
  };
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1.5 p-0 text-body-sm font-medium text-ink">
        Required facilities <span className="font-normal text-ink-subtle">(optional)</span>
      </legend>
      <p className="m-0 -mt-1 text-body-sm text-ink-muted">Pick only what you cannot learn without. Fewer requirements mean more classes can fit you.</p>
      {options.length === 0 ? (
        <p className="m-0 text-body-sm text-ink-muted">No facility types are set up yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <Checkbox key={o.id} id={`facility-${o.id}`} label={o.name} checked={selected.has(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
          ))}
        </div>
      )}
      {fieldState.error?.message ? <p className="m-0 text-body-sm text-danger-ink">{fieldState.error.message}</p> : null}
    </fieldset>
  );
}

export interface RequestFormProps {
  /** Present when editing an existing request (PATCH). */
  existing?: RequestFullDto;
  /** Prefilled category for a new request (from Discover Courses). */
  initialCategoryId?: string;
}

/** New / edit learning request (PLAN 2.7). */
export function RequestForm({ existing, initialCategoryId }: RequestFormProps) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const lookups = useLookups();
  const editing = Boolean(existing);

  const { control, handleSubmit, setError, formState } = useForm<FormIn, unknown, FormOut>({
    resolver,
    defaultValues: defaultsFrom(existing, initialCategoryId),
  });

  const catOptions = useMemo(
    () => categoryOptions((lookups.data?.categories ?? []) as { id: string; name: string; parentId?: string | null }[]),
    [lookups.data],
  );

  const onSubmit = handleSubmit(async (values) => {
    const body = { ...values, budgetPerMonth: values.budgetPerMonth ?? null, notes: values.notes ?? '' };
    try {
      const saved = existing
        ? await apiSend<RequestFullDto>('PATCH', `/api/requests/${existing.id}`, body)
        : await apiSend<RequestFullDto>('POST', '/api/requests', body);
      await qc.invalidateQueries({ queryKey: requestKeys.all });
      toast.success(editing ? 'Request updated' : 'Request submitted');
      router.push(`/requests/${saved.id}`);
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });

  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col">
      {rootError ? (
        <div className="px-4 pt-4 lg:px-6">
          <Alert tone="danger">{rootError}</Alert>
        </div>
      ) : null}
      <PanelGrid columns={2}>
        <Panel title="Course" description="What you want to learn and when you can start.">
          <div className="flex flex-col gap-4">
            {lookups.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <FormSelect control={control} name="categoryId" label="Course category" required options={catOptions} placeholder="Choose a category" />
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormInput control={control} name="startMonth" label="Start month" type="month" required mono />
              <FormInput control={control} name="durationMonths" label="Duration (months)" type="number" min={1} max={24} step={1} required mono />
            </div>
            <FormInput
              control={control}
              name="budgetPerMonth"
              label="Budget per month (₹)"
              type="number"
              min={0}
              step={100}
              optional
              mono
              hint="Leave empty if any fee works for you."
            />
            <FormTextarea control={control} name="notes" label="Notes" optional rows={3} maxLength={1000} placeholder="Anything the course provider should know" />
          </div>
        </Panel>

        <Panel title="Location" description="Where you will travel from and how far you can go.">
          <div className="flex flex-col gap-4">
            <FormLocationPicker
              control={control}
              name="location"
              label="Your location"
              hint="Your exact location stays private. Others only see your area."
            />
            <FormInput
              control={control}
              name="maxDistanceKm"
              label="Maximum travel distance (km)"
              type="number"
              min={0.5}
              max={50}
              step={0.5}
              required
              mono
            />
          </div>
        </Panel>

        <Panel title="Preferred Times" description="Weekly windows when you can attend a class.">
          <FormWindowEditor control={control} name="windows" label="Weekly windows" hint="Leave empty if you are flexible." />
        </Panel>

        <Panel title="Facilities" description="Anything the space must have for you to attend.">
          {lookups.isPending ? <Skeleton className="h-24 w-full" /> : <FacilityChecklist control={control} options={lookups.data?.facilityTypes ?? []} />}
        </Panel>

        <Panel title="Consent" description="What is shared about you, and when." className="lg:col-span-2">
          <div className="flex flex-col gap-4">
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-body-sm text-ink">
              <li>Before you are matched, course providers and space givers see only counts of requests per area and course.</li>
              <li>When a class is proposed for you, they see your area and preferred timings, not your name.</li>
              <li>After you accept an offer, your name and contact details go to the course provider, and your name goes to the space for entry.</li>
              <li>Your exact location is never shared. Others see only your area.</li>
            </ul>
            <FormCheckbox control={control} name="consentShared" label="I agree to share these details at these stages" />
            <div className="flex flex-col gap-2 border-t border-dashed border-border-strong pt-4">
              <p className="m-0 text-body-sm text-ink-muted">
                {editing ? 'Saving may re-run matching for your request.' : 'We will look for a class and space that fit you.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" icon={editing ? 'check' : 'send'} loading={formState.isSubmitting}>
                  {editing ? 'Save Changes' : 'Submit Request'}
                </Button>
                <Button variant="ghost" href={existing ? `/requests/${existing.id}` : '/requests'}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      </PanelGrid>
    </form>
  );
}
