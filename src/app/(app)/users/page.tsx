import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { UsersScreen } from '@/components/admin/users-screen';

export const metadata: Metadata = { title: 'Users' };

/** User administration (PLAN 7.8). Administrator only. */
export default async function UsersPage() {
  const session = await auth();
  if (session?.user?.role !== 'Administrator') redirect('/dashboard?denied=1');
  return <UsersScreen />;
}
