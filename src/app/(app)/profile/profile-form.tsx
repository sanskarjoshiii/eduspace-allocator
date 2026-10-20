'use client';

import { useMemo } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Badge, Button, ErrorState, KeyValueList, PageHeader, Panel, PanelGrid, SkeletonText, useToast,
} from '@/components/ui';
import { FormCommaList, FormInput, FormSelect, FormSwitch, applyServerErrors } from '@/components/forms';
import { useLookups } from '@/hooks/use-lookups';
import { meKeys } from '@/hooks/use-me';
import { apiGet, apiSend } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/domain';
import { formatDate } from '@/lib/format';
import { MeUpdate } from '@/schemas/user';
import type { AccountDto } from '@/server/dto/user';

const accountKey = [...meKeys.me, 'account'] as const;

function ProfileEditor({ account }: { account: AccountDto }) {
  const toast = useToast();
  const qc = useQueryClient();
  const lookups = useLookups();
  const { user, profile, partner } = account;
  const isLearner = user.role === 'Learner';
  const hasContact = Boolean(profile || partner);

  const { control, handleSubmit, setError, formState, reset } = useForm<MeUpdate>({
    resolver: zodResolver(MeUpdate) as Resolver<MeUpdate>,
    defaultValues: {
      name: user.name,
      contactPhone: profile?.contactPhone ?? partner?.contactPhone ?? '',
      emailNotifications: user.emailNotifications,
      accessibilityNeeds: profile?.accessibilityNeeds ?? [],
      areaId: profile?.areaId ?? undefined,
    },
  });

  const areaOptions = useMemo(
    () => [...(lookups.data?.areas ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ value: a.id, label: a.name })),
    [lookups.data],
  );

  const onSubmit = handleSubmit(async (values) => {
    // Send only what this role may change; learner-only fields are rejected for other roles.
    const body: MeUpdate = { name: values.name, emailNotifications: values.emailNotifications };
    if (hasContact) body.contactPhone = values.contactPhone ?? '';
    if (isLearner) {
      body.accessibilityNeeds = values.accessibilityNeeds ?? [];
      body.areaId = values.areaId ?? null;
    }
    try {
      const saved = await apiSend<AccountDto>('PATCH', '/api/me', body);
      qc.setQueryData(accountKey, saved);
      await qc.invalidateQueries({ queryKey: meKeys.me });
      reset(values);
      toast.success('Profile saved');
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });
  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;

  return (
    <form onSubmit={onSubmit} noValidate>
      <PanelGrid columns={2}>
        <Panel title="Your Details" description="How you appear to others on EduSpace.">
          <div className="flex flex-col gap-4">
            {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
            <FormInput control={control} name="name" label="Name" required autoComplete="name" />
            {hasContact ? (
              <FormInput
                control={control}
                name="contactPhone"
                label="Contact phone"
                type="tel"
                autoComplete="tel"
                optional
                mono
                hint={isLearner ? 'Shared with a course provider only after you accept their offer.' : 'Shown to administrators and partners you work with.'}
              />
            ) : null}
            <FormSwitch
              control={control}
              name="emailNotifications"
              label="Email notifications"
              hint="Email copies are sent only when your administrator has enabled email."
            />
          </div>
        </Panel>

        {isLearner ? (
          <Panel title="Learning Preferences" description="Helps us find classes you can reach and attend comfortably.">
            <div className="flex flex-col gap-4">
              <FormSelect
                control={control}
                name="areaId"
                label="Home area"
                options={areaOptions}
                placeholder={lookups.isPending ? 'Loading areas' : 'Choose your area'}
                optional
                hint="Used for Discover Courses. Others only ever see your area, never your exact location."
              />
              <FormCommaList
                control={control}
                name="accessibilityNeeds"
                label="Accessibility needs"
                optional
                placeholder="Wheelchair access, ground floor"
                hint="Separate needs with commas. Shared with your course provider after you accept."
              />
            </div>
          </Panel>
        ) : (
          <Panel title="Account" description="Your sign-in and role.">
            <KeyValueList
              items={[
                { label: 'Email', value: user.email },
                { label: 'Role', value: <Badge>{ROLE_LABEL[user.role]}</Badge> },
                ...(partner ? [{ label: 'Organisation', value: partner.name }] : []),
                { label: 'Member since', value: formatDate(user.createdAt), mono: true },
              ]}
            />
          </Panel>
        )}

        {isLearner ? (
          <Panel title="Account" description="Your sign-in, role and age band." className="lg:col-span-2">
            <KeyValueList
              columns={2}
              items={[
                { label: 'Email', value: user.email },
                { label: 'Role', value: <Badge>{ROLE_LABEL[user.role]}</Badge> },
                { label: 'Age band', value: profile?.ageBand || '—' },
                { label: 'Member since', value: formatDate(user.createdAt), mono: true },
              ]}
            />
          </Panel>
        ) : null}
      </PanelGrid>
      <div className="flex flex-wrap justify-end gap-2 px-4 py-4 lg:px-6">
        <Button variant="ghost" onClick={() => reset()} disabled={!formState.isDirty || formState.isSubmitting}>
          Discard Changes
        </Button>
        <Button type="submit" variant="primary" icon="check" loading={formState.isSubmitting}>
          Save Profile
        </Button>
      </div>
    </form>
  );
}

/** /profile (all roles): GET and PATCH /api/me. */
export function ProfileForm() {
  const query = useQuery({ queryKey: accountKey, queryFn: () => apiGet<AccountDto>('/api/me') });
  return (
    <>
      <PageHeader title="Profile" description="Your name, contact details and notification settings." />
      {query.isPending ? (
        <PanelGrid columns={2}>
          <Panel title="Your Details">
            <SkeletonText lines={6} />
          </Panel>
          <Panel title="Account">
            <SkeletonText lines={4} />
          </Panel>
        </PanelGrid>
      ) : query.error || !query.data ? (
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      ) : (
        <ProfileEditor account={query.data} />
      )}
    </>
  );
}
