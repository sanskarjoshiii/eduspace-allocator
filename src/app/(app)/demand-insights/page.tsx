import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { DemandInsightsScreen } from '@/components/insights/demand-insights-screen';

export const metadata: Metadata = { title: 'Demand Insights' };

/** Aggregated demand by area and category (PLAN 5.4, 6.1 heatmap). Every signed-in role. */
export default async function DemandInsightsPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  return <DemandInsightsScreen role={role} />;
}
