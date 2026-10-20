import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SpaceForm } from '@/components/spaces/space-form';

export const metadata: Metadata = { title: 'Add Space' };

/** /spaces/new: Space Givers and Administrators. */
export default async function NewSpacePage() {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  if (role !== 'SpaceGiver' && role !== 'Administrator') redirect('/spaces');
  return <SpaceForm isAdmin={role === 'Administrator'} />;
}
