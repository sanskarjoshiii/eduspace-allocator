import type { Metadata } from 'next';
import { OfferingScreen } from '@/components/offerings/offering-screen';

export const metadata: Metadata = { title: 'Offering' };

/** /offerings/[id]: edit for the owner and Administrators, catalogue detail for others. */
export default async function OfferingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfferingScreen id={id} />;
}
