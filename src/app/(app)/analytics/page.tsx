import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AnalyticsScreen } from '@/components/insights/analytics-screen';

export const metadata: Metadata = { title: 'Analytics' };

/** Role-scoped analytics (PLAN 7.4). The proxy keeps Learners out; the screen still handles a 403. */
export default async function AnalyticsPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  return <AnalyticsScreen role={role} />;
}
