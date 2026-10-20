import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/shell/app-shell';
import { MENUS } from '@/server/auth/menu';

/** Signed-in shell. The proxy guards pages too; this is the server-side check. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.role) redirect('/login');
  const { name, email, role } = session.user;
  return (
    <AppShell user={{ name: name ?? email ?? 'Signed in', email: email ?? '', role }} initialMenu={MENUS[role] ?? []}>
      {children}
    </AppShell>
  );
}
