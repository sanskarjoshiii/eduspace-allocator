import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PageHeader } from '@/components/ui';
import { RequestForm } from '@/components/requests/request-form';

export const metadata: Metadata = { title: 'New Request' };

/** Learner: submit a learning request (PLAN 2.7). `?categoryId=` prefills the category. */
export default async function NewRequestPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (session?.user?.role !== 'Learner') redirect('/requests');
  const sp = await searchParams;
  const raw = Array.isArray(sp.categoryId) ? sp.categoryId[0] : sp.categoryId;
  const categoryId = raw && /^[a-f\d]{24}$/i.test(raw) ? raw : undefined;
  return (
    <>
      <PageHeader title="New Request" description="Tell us what you want to learn, where and when. We will find a class and space that fit." />
      <RequestForm initialCategoryId={categoryId} />
    </>
  );
}
