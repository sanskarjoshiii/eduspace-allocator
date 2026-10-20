import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { RunMonitor } from '@/components/runs/run-monitor';

export const metadata: Metadata = { title: 'Smart Allocation' };

/** Run monitor (PLAN 3.15). Administrator only. */
export default async function RunsPage() {
  const session = await auth();
  if (session?.user?.role !== 'Administrator') redirect('/dashboard?denied=1');
  return <RunMonitor />;
}
