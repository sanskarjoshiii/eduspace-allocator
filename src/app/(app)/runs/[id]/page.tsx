import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { RunDetail } from '@/components/runs/run-detail';

export const metadata: Metadata = { title: 'Run' };

/** Run detail and comparison report (PLAN 7.9). Administrator only. */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'Administrator') redirect('/dashboard?denied=1');
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  return <RunDetail id={id} />;
}
