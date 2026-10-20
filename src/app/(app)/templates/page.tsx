import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { TemplatesScreen } from '@/components/admin/templates-screen';

export const metadata: Metadata = { title: 'Notification Templates' };

/** Notification template editor (PLAN 5.1). Administrator only. */
export default async function TemplatesPage() {
  const session = await auth();
  if (session?.user?.role !== 'Administrator') redirect('/dashboard?denied=1');
  return <TemplatesScreen />;
}
