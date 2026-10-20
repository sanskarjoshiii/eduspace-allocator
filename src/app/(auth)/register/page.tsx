import type { Metadata } from 'next';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Register' };

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-title text-ink">Create Account</h1>
        <p className="m-0 text-body-sm text-ink-muted">Choose how you will use EduSpace, then fill in your details.</p>
      </div>
      <RegisterForm />
    </div>
  );
}
