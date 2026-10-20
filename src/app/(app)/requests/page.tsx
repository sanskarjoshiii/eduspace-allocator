import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AdminRequests, LearnerRequests, MatchedRequests } from '@/components/requests/request-lists';

export const metadata: Metadata = { title: 'Requests' };

/** Learner: My Requests. Administrator: all requests. Course Provider / Space Giver: matched requests only. */
export default async function RequestsPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  if (role === 'Learner') return <LearnerRequests />;
  if (role === 'Administrator') return <AdminRequests />;
  return <MatchedRequests role={role} />;
}
