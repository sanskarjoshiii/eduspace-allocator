import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { OffersView } from '@/components/offers/offers-view';

export const metadata: Metadata = { title: 'Offers' };

/** Learner: offers, waitlist places and accepted classes (GET /api/enrollments/mine is Learner only). */
export default async function OffersPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  if (role !== 'Learner') redirect(role === 'Administrator' ? '/requests' : '/dashboard?denied=1');
  return <OffersView />;
}
