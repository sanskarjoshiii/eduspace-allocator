import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { FacilityIssuesView } from '@/components/facility-issues/facility-issues-view';

export const metadata: Metadata = { title: 'Facility Issues' };

/** Facility issues (PLAN 7.1–7.2). Space Giver: own spaces; Administrator: all. */
export default async function FacilityIssuesPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== 'SpaceGiver' && role !== 'Administrator') redirect('/dashboard?denied=1');
  return <FacilityIssuesView role={role} />;
}
