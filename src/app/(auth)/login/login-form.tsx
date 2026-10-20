'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormInput } from '@/components/forms/form-fields';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { LoginInput } from '@/schemas/auth';

/** Only same-origin relative paths are allowed as a post-login destination. */
export function safeCallbackUrl(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard';
  if (raw === '/login' || raw.startsWith('/login?') || raw === '/register') return '/dashboard';
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm({
    resolver: zodResolver(LoginInput),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const res = await signIn('credentials', { email: values.email, password: values.password, redirect: false });
    if (!res || res.error) {
      setError(res?.code === 'account_blocked' ? 'Your account is waiting for approval or suspended.' : 'Email or password is incorrect.');
      return;
    }
    router.push(safeCallbackUrl(params.get('callbackUrl')));
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <FormInput control={control} name="email" label="Email" type="email" autoComplete="email" required />
      <FormInput control={control} name="password" label="Password" type="password" autoComplete="current-password" required />
      <Button type="submit" variant="primary" block loading={formState.isSubmitting}>
        Sign In
      </Button>
      <p className="m-0 text-center text-body-sm text-ink-muted">
        New to EduSpace?{' '}
        <Link href="/register" className="font-medium text-ink underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </form>
  );
}
