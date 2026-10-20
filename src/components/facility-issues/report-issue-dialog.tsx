'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, type Paged } from '@/lib/api';
import type { Role } from '@/lib/domain';
import { formatNumber } from '@/lib/format';
import { FacilityIssueInput } from '@/schemas/facility-issue';
import { useLookups } from '@/hooks/use-lookups';
import { FormInput, FormSelect, FormTextarea, applyServerErrors } from '@/components/forms';
import { Alert, Button, Dialog, useToast } from '@/components/ui';
import { facilityIssueKeys, type FacilityIssueDto } from './facility-issue-hooks';

interface SpaceOption {
  id: string;
  name: string;
  areaName: string | null;
  facilities: { facilityTypeId: string; quantity: number; workingQuantity: number }[];
}

type FormIn = z.input<typeof FacilityIssueInput>;
type FormOut = z.output<typeof FacilityIssueInput>;

const EMPTY: FormIn = { spaceId: '', facilityTypeId: '', affectedQuantity: 1, description: '', evidenceUrl: '' };

/** "Report Issue" dialog: POST /api/facility-issues, then shows how many allocations were affected. */
export function ReportIssueDialog({ open, onClose, role, defaultSpaceId }: { open: boolean; onClose: () => void; role: Role; defaultSpaceId?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();
  const [result, setResult] = useState<FacilityIssueDto | null>(null);
  const { control, handleSubmit, setError, reset, setValue, formState } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(FacilityIssueInput),
    defaultValues: EMPTY,
  });
  const spaceId = useWatch({ control, name: 'spaceId' });
  const close = () => {
    setResult(null);
    onClose();
  };

  useEffect(() => {
    if (open) reset({ ...EMPTY, spaceId: defaultSpaceId ?? '' });
  }, [open, defaultSpaceId, reset]);

  const spaces = useQuery({
    queryKey: ['spaces', 'issue-options', role],
    queryFn: () => apiGet<Paged<SpaceOption>>('/api/spaces', { mine: role === 'SpaceGiver' ? 1 : undefined, pageSize: 200 }),
    enabled: open,
    staleTime: 60_000,
  });

  const space = spaces.data?.items.find((s) => s.id === spaceId);
  const facilityName = (id: string) => lookups.data?.facilityTypes.find((f) => f.id === id)?.name ?? 'Facility';
  const facilityOptions = (space?.facilities ?? []).map((f) => ({
    value: f.facilityTypeId,
    label: `${facilityName(f.facilityTypeId)} (${formatNumber(f.workingQuantity)} of ${formatNumber(f.quantity)} working)`,
  }));

  useEffect(() => {
    setValue('facilityTypeId', '');
  }, [spaceId, setValue]);

  const mutation = useMutation({
    mutationFn: (body: FormOut) => apiSend<FacilityIssueDto>('POST', '/api/facility-issues', body),
    onSuccess: (issue) => {
      setResult(issue);
      toast.success('Issue reported');
      void qc.invalidateQueries({ queryKey: facilityIssueKeys.all });
      void qc.invalidateQueries({ queryKey: ['allocations'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync(values);
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });
  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;

  if (result) {
    const affected = result.affectedAllocationIds.length;
    const replacements = result.replacementAllocationIds.length;
    return (
      <Dialog
        open={open}
        onClose={close}
        title="Issue Reported"
        description={`${result.facilityName} at ${result.spaceName}.`}
        footer={
          <>
            <Button variant="ghost" href={`/facility-issues/${result.id}`}>
              View Issue
            </Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {affected === 0 ? (
            <Alert tone="success" title="No classes affected">
              Every class booked in this space still fits with the facilities that work.
            </Alert>
          ) : (
            <Alert tone="warning" title={`${formatNumber(affected)} ${affected === 1 ? 'allocation' : 'allocations'} affected`}>
              {replacements
                ? `Smart Allocation proposed ${formatNumber(replacements)} ${replacements === 1 ? 'replacement' : 'replacements'}. Nothing moves until the new space approves and the provider confirms.`
                : 'No replacement space was found yet. The classes stay flagged for reallocation.'}
            </Alert>
          )}
          {affected ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {result.affectedAllocationIds.map((id, i) => (
                <li key={id}>
                  <Link className="text-body-sm text-accent-ink underline underline-offset-2" href={`/allocations/${id}`}>
                    Affected allocation {i + 1} and its reallocation proposal
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!formState.isSubmitting}
      title="Report Issue"
      description="Tell us what stopped working. Classes that no longer fit get a replacement proposal."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="report-issue-form" loading={formState.isSubmitting}>
            Report Issue
          </Button>
        </>
      }
    >
      <form id="report-issue-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
        {spaces.isError ? <Alert tone="danger">Your spaces could not be loaded. Close this and try again.</Alert> : null}
        <FormSelect
          control={control}
          name="spaceId"
          label="Space"
          required
          placeholder={spaces.isPending ? 'Loading spaces' : 'Choose a space'}
          options={(spaces.data?.items ?? []).map((s) => ({ value: s.id, label: s.areaName ? `${s.name}, ${s.areaName}` : s.name }))}
        />
        <FormSelect
          control={control}
          name="facilityTypeId"
          label="Facility"
          required
          disabled={!space}
          hint={space && !facilityOptions.length ? 'This space lists no facilities.' : undefined}
          placeholder={space ? 'Choose a facility' : 'Choose a space first'}
          options={facilityOptions}
        />
        <FormInput control={control} name="affectedQuantity" label="Units affected" type="number" min={1} required hint="How many units stopped working." />
        <FormTextarea control={control} name="description" label="Description" optional rows={3} maxLength={2000} placeholder="What happened and since when?" />
        <FormInput control={control} name="evidenceUrl" label="Evidence link" optional type="url" placeholder="https://" hint="A photo or document link." />
      </form>
    </Dialog>
  );
}
