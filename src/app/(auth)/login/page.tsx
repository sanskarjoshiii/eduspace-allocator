import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SkeletonText } from '@/components/ui/skeleton';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign In' };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-title text-ink">Sign In</h1>
        <p className="m-0 text-body-sm text-ink-muted">Use the email and password you registered with.</p>
      </div>
      <Suspense fallback={<SkeletonText lines={4} />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
