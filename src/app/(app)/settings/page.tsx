import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SettingsScreen } from '@/components/admin/settings-screen';

export const metadata: Metadata = { title: 'Settings' };

/** System settings (PLAN 7.7). Administrator only; the proxy guards the route too. */
export default async function SettingsPage() {
  const session = await auth();
  if (session?.user?.role !== 'Administrator') redirect('/dashboard?denied=1');
  return <SettingsScreen />;
}
