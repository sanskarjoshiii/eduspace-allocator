import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AllocationDetail } from '@/components/allocations/allocation-detail';

export const metadata: Metadata = { title: 'Allocation' };

/** Allocation detail with the Explain panel (PLAN 6.7) and role actions (PLAN 4.2–4.4). */
export default async function AllocationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  return <AllocationDetail id={id} role={role} />;
}
