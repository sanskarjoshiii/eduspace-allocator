'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { applyServerErrors, FormCommaList, FormInput, FormSelect } from '@/components/forms';
import { Alert, Button, Dialog } from '@/components/ui';
import { useLookups } from '@/hooks/use-lookups';
import { apiSend } from '@/lib/api';
import { AGE_BANDS, ROLE_LABEL, ROLES, type PartnerType } from '@/lib/domain';
import { CreateUserInput } from '@/schemas/user';
import { useReportSubmitting } from './use-report-submitting';

const FORM_ID = 'add-user-form';

const PARTNER_LABEL: Record<PartnerType, string> = {
  SpaceGiverOrg: 'Space-giving organisation',
  ProviderOrg: 'Course provider organisation',
  IndividualTutor: 'Individual tutor',
};

export function AddUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (name: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Add User"
      description="Create an account for any role, including another Administrator. Share the password with them securely."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID} loading={busy}>
            Add User
          </Button>
        </>
      }
    >
      {open ? <AddUserFields onClose={onClose} onCreated={onCreated} onBusyChange={setBusy} /> : null}
    </Dialog>
  );
}

function AddUserFields({
  onClose, onCreated, onBusyChange,
}: {
  onClose: () => void;
  onCreated: (name: string) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const lookups = useLookups();
  const { control, handleSubmit, setError, setValue, formState } = useForm({
    resolver: zodResolver(CreateUserInput),
    defaultValues: {
      role: 'Learner',
      name: '',
      email: '',
      password: '',
      status: 'Active',
      contactPhone: '',
      accessibilityNeeds: [],
      organisationName: '',
    },
  });
  useReportSubmitting(formState.isSubmitting, onBusyChange);
  const role = useWatch({ control, name: 'role' });
  const partnerType = useWatch({ control, name: 'partnerType' });
  const isPartner = role === 'SpaceGiver' || role === 'CourseProvider';

  useEffect(() => {
    if (role === 'SpaceGiver') setValue('partnerType', 'SpaceGiverOrg');
    else if (role === 'CourseProvider') setValue('partnerType', 'ProviderOrg');
    else setValue('partnerType', undefined);
  }, [role, setValue]);

  const partnerOptions = (role === 'SpaceGiver' ? (['SpaceGiverOrg', 'ProviderOrg'] as const) : (['ProviderOrg', 'IndividualTutor'] as const)).map((p) => ({
    value: p,
    label: PARTNER_LABEL[p],
  }));

  const onSubmit = handleSubmit(async (v) => {
    const learner = v.role === 'Learner';
    const partner = v.role === 'SpaceGiver' || v.role === 'CourseProvider';
    const body = {
      role: v.role,
      name: v.name,
      email: v.email,
      password: v.password,
      status: v.status,
      contactPhone: v.contactPhone || undefined,
      ...(learner ? { ageBand: v.ageBand, areaId: v.areaId || undefined, accessibilityNeeds: v.accessibilityNeeds } : {}),
      ...(partner ? { partnerType: v.partnerType, organisationName: v.organisationName || undefined } : {}),
    };
    try {
      await apiSend('POST', '/api/users', body);
      await onCreated(v.name);
      onClose();
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });

  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelect control={control} name="role" label="Role" options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} required />
        <FormSelect
          control={control}
          name="status"
          label="Status"
          options={[
            { value: 'Active', label: 'Active' },
            { value: 'PendingApproval', label: 'Pending approval' },
          ]}
          hint="Pending accounts cannot sign in until approved."
        />
        <FormInput control={control} name="name" label="Full Name" autoComplete="off" required />
        <FormInput control={control} name="email" label="Email" type="email" autoComplete="off" required />
        <FormInput
          control={control}
          name="password"
          label="Temporary Password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters with a letter and a number."
          required
        />
        <FormInput control={control} name="contactPhone" label="Phone" type="tel" optional />
      </div>

      {role === 'Learner' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormSelect control={control} name="ageBand" label="Age Band" placeholder="Choose an age band" options={AGE_BANDS.map((a) => ({ value: a, label: a }))} required />
          <FormSelect
            control={control}
            name="areaId"
            label="Area"
            placeholder={lookups.isPending ? 'Loading areas' : 'Choose an area'}
            options={(lookups.data?.areas ?? []).map((a) => ({ value: a.id, label: a.name }))}
            disabled={lookups.isPending || lookups.isError}
            optional
          />
          <FormCommaList
            control={control}
            name="accessibilityNeeds"
            label="Accessibility Needs"
            placeholder="Step-free entrance, hearing loop"
            hint="Separate with commas."
            optional
            className="sm:col-span-2"
          />
        </div>
      ) : null}

      {isPartner ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormSelect control={control} name="partnerType" label="Organisation Type" options={partnerOptions} required />
          {partnerType !== 'IndividualTutor' ? (
            <FormInput control={control} name="organisationName" label="Organisation Name" required />
          ) : null}
        </div>
      ) : null}

      {role === 'Administrator' ? (
        <Alert tone="warning">Administrators can change every setting, account and record. Add only people who run EduSpace.</Alert>
      ) : null}
    </form>
  );
}
