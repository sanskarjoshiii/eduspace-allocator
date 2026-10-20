import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { RequestEdit } from '@/components/requests/request-detail';

export const metadata: Metadata = { title: 'Edit Request' };

/** Edit a request while it is Submitted, Analysed or Unmatched (owner Learner or Administrator). */
export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  const session = await auth();
  const role = session?.user?.role;
  if (role !== 'Learner' && role !== 'Administrator') redirect(`/requests/${id}`);
  return <RequestEdit id={id} />;
}
