import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { FacilityIssueDetail } from '@/components/facility-issues/facility-issue-detail';

export const metadata: Metadata = { title: 'Facility Issue' };

/** Facility issue detail with its affected allocations. */
export default async function FacilityIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== 'SpaceGiver' && role !== 'Administrator') redirect('/dashboard?denied=1');
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  return <FacilityIssueDetail id={id} role={role} />;
}
