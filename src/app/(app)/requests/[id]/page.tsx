import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RequestDetail } from '@/components/requests/request-detail';

export const metadata: Metadata = { title: 'Learning Request' };

/** Request detail: status timeline, details, suggestions (Unmatched) and actions. */
export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  return <RequestDetail id={id} />;
}
