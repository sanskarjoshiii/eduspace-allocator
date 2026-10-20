import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { LearnersView } from '@/components/learners/learners-view';

export const metadata: Metadata = { title: 'Learners' };

/** Course Provider and Administrator: roster, attendance marking and feedback per class (PLAN 7.3). */
export default async function LearnersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  if (role !== 'CourseProvider' && role !== 'Administrator') redirect('/dashboard?denied=1');
  const sp = await searchParams;
  const raw = Array.isArray(sp.allocationId) ? sp.allocationId[0] : sp.allocationId;
  return <LearnersView initialAllocationId={raw && /^[a-f\d]{24}$/i.test(raw) ? raw : undefined} />;
}
