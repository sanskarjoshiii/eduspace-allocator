import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SpacesList } from '@/components/spaces/spaces-list';

export const metadata: Metadata = { title: 'Spaces' };

/** /spaces: My Spaces (Space Giver), Space Registry (Administrator) or the public directory. */
export default async function SpacesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await auth();
  if (!session?.user?.role) redirect('/login');
  const { view } = await searchParams;
  return <SpacesList role={session.user.role} view={view === 'policies' ? 'policies' : 'list'} />;
}
