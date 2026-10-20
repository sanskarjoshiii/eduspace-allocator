import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { LookupsScreen } from '@/components/admin/lookups-screen';

export const metadata: Metadata = { title: 'Lookups' };

/** Facility types, course categories and areas (PLAN 2.1). Administrator only. */
export default async function LookupsPage() {
  const session = await auth();
  if (session?.user?.role !== 'Administrator') redirect('/dashboard?denied=1');
  return <LookupsScreen />;
}
