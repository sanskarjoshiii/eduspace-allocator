import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { DashboardView } from '@/components/dashboard/dashboard-view';

export const metadata: Metadata = { title: 'Dashboard' };

/** Role dashboard (PLAN 6.1–6.4, README 17). */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  const { denied } = await searchParams;
  return <DashboardView role={role} denied={denied === '1'} />;
}
