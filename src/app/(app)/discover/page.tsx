import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { DiscoverView } from '@/components/requests/discover-view';

export const metadata: Metadata = { title: 'Discover Courses' };

/** Learner: open classes near their area and suggested categories (F-36, PLAN 5.6). */
export default async function DiscoverPage() {
  const session = await auth();
  if (!session?.user?.role) redirect('/login');
  if (session.user.role !== 'Learner') redirect('/dashboard?denied=1');
  return <DiscoverView />;
}
