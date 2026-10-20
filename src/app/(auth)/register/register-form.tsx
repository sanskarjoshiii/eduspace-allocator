'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { applyServerErrors, FormCheckbox, FormCommaList, FormInput, FormRadioGroup, FormSelect } from '@/components/forms/form-fields';
import { ActionTile, Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { useLookups } from '@/hooks/use-lookups';
import { apiSend } from '@/lib/api';
import { AGE_BANDS, ROLE_LABEL, type UserStatus } from '@/lib/domain';
import { RegisterInput } from '@/schemas/auth';

type SelfRole = 'Learner' | 'SpaceGiver' | 'CourseProvider';

const ROLE_TILES: { role: SelfRole; icon: 'graduation-cap' | 'school' | 'presentation'; description: string }[] = [
  { role: 'Learner', icon: 'graduation-cap', description: 'Find a class near you.' },
  { role: 'SpaceGiver', icon: 'school', description: 'Share your idle rooms.' },
  { role: 'CourseProvider', icon: 'presentation', description: 'Teach in nearby spaces.' },
];

const PROVIDER_TYPES = [
  { value: 'ProviderOrg', label: 'Organisation', description: 'An institute, academy, NGO or studio.' },
  { value: 'IndividualTutor', label: 'Individual tutor', description: 'You teach on your own.' },
];

export function RegisterForm() {
  const router = useRouter();
  const lookups = useLookups();
  const [role, setRole] = useState<SelfRole | null>(null);
  const [pending, setPending] = useState(false);
  const { control, handleSubmit, setValue, setError, formState } = useForm({
    resolver: zodResolver(RegisterInput),
    defaultValues: {
      role: 'Learner',
      name: '',
      email: '',
      password: '',
      contactPhone: '',
      accessibilityNeeds: [],
      consent: false,
      organisationName: '',
    },
  });
  const partnerType = useWatch({ control, name: 'partnerType' });

  const choose = (r: SelfRole) => {
    setRole(r);
    setValue('role', r);
    setValue('partnerType', r === 'SpaceGiver' ? 'SpaceGiverOrg' : r === 'CourseProvider' ? 'ProviderOrg' : undefined);
  };

  const onSubmit = handleSubmit(async (values) => {
    const learner = values.role === 'Learner';
    const payload = {
      role: values.role,
      name: values.name,
      email: values.email,
      password: values.password,
      contactPhone: values.contactPhone,
      ...(learner
        ? { ageBand: values.ageBand, areaId: values.areaId || undefined, accessibilityNeeds: values.accessibilityNeeds, consent: values.consent }
        : { partnerType: values.partnerType, organisationName: values.organisationName || undefined }),
    };
    try {
      const { user } = await apiSend<{ user: { status: UserStatus } }>('POST', '/api/auth/register', payload);
      if (user.status === 'PendingApproval') {
        setPending(true);
        return;
      }
      const res = await signIn('credentials', { email: values.email, password: values.password, redirect: false });
      if (!res || res.error) {
        setError('root.server', {
          message: res?.code === 'account_blocked' ? 'Your account is waiting for Administrator approval.' : 'Your account was created. Sign in to continue.',
        });
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });

  if (pending) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" title="Account created">
          Your account is waiting for Administrator approval. We will let you know by email when you can sign in.
        </Alert>
        <Button href="/" variant="secondary">
          Back to Home
        </Button>
      </div>
    );
  }

  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 p-0 text-body-sm font-medium text-ink">I am a</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {ROLE_TILES.map((t) => (
            <ActionTile key={t.role} icon={t.icon} label={ROLE_LABEL[t.role]} description={t.description} selected={role === t.role} onClick={() => choose(t.role)} />
          ))}
        </div>
      </fieldset>

      {role ? (
        <>
          {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
          <FormInput control={control} name="name" label={role === 'Learner' ? 'Full Name' : 'Your Name'} autoComplete="name" required />
          <FormInput control={control} name="email" label="Email" type="email" autoComplete="email" required />
          <FormInput
            control={control}
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 10 characters with a letter and a number."
            required
          />
          <FormInput control={control} name="contactPhone" label="Phone" type="tel" autoComplete="tel" optional />

          {role === 'Learner' ? (
            <>
              <FormSelect control={control} name="ageBand" label="Age Band" placeholder="Choose your age band" options={AGE_BANDS.map((a) => ({ value: a, label: a }))} required />
              <FormSelect
                control={control}
                name="areaId"
                label="Your Area"
                placeholder={lookups.isPending ? 'Loading areas' : 'Choose your area'}
                options={(lookups.data?.areas ?? []).map((a) => ({ value: a.id, label: a.name }))}
                hint={lookups.isError ? 'Areas could not load. You can add your area later.' : 'Used to find classes near you. Others only ever see the area, never your address.'}
                disabled={lookups.isPending || lookups.isError}
                optional
              />
              <FormCommaList
                control={control}
                name="accessibilityNeeds"
                label="Accessibility Needs"
                placeholder="Wheelchair access, ground floor"
                hint="Separate needs with commas."
                optional
              />
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-3">
                <p className="m-0 text-body-sm text-ink-muted">
                  Before you accept an offer, course providers and space givers see only anonymous counts by area and course. After you accept, the course
                  provider sees your name, age band, contact details and request; the space giver sees only your name, for entry. Your exact location is never
                  shared with them.
                </p>
                <FormCheckbox control={control} name="consent" label="I agree to share my details as described above." />
              </div>
            </>
          ) : (
            <>
              {role === 'CourseProvider' ? (
                <FormRadioGroup control={control} name="partnerType" label="You register as" options={PROVIDER_TYPES} orientation="vertical" />
              ) : null}
              <FormInput
                control={control}
                name="organisationName"
                label="Organisation Name"
                hint={role === 'SpaceGiver' ? 'The school, college, NGO or hall that owns the spaces.' : undefined}
                autoComplete="organization"
                required={partnerType !== 'IndividualTutor'}
                optional={partnerType === 'IndividualTutor'}
              />
            </>
          )}

          <Button type="submit" variant="primary" block loading={formState.isSubmitting}>
            Create Account
          </Button>
        </>
      ) : null}

      <p className="m-0 text-center text-body-sm text-ink-muted">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-ink underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
