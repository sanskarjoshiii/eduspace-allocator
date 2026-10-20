import type { Metadata } from 'next';
import { SpaceScreen } from '@/components/spaces/space-screen';

export const metadata: Metadata = { title: 'Space' };

/** /spaces/[id]: edit for the owner and Administrators, read-only detail for others. */
export default async function SpacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SpaceScreen id={id} />;
}
