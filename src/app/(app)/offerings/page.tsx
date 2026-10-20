import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { OfferingsList } from '@/components/offerings/offerings-list';

export const metadata: Metadata = { title: 'Offerings' };

/** /offerings: own offerings (Course Provider), all (Administrator), Open catalogue (Learner, Space Giver). */
export default async function OfferingsPage() {
  const session = await auth();
  if (!session?.user?.role) redirect('/login');
  return <OfferingsList role={session.user.role} />;
}
