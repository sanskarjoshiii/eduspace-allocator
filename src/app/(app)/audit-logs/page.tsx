import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AuditLogScreen } from '@/components/admin/audit-log-screen';

export const metadata: Metadata = { title: 'Audit Logs' };

/** Administrator: the full audit log. Space Giver / Course Provider: their own activity. Learners are redirected. */
export default async function AuditLogsPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== 'Administrator' && role !== 'SpaceGiver' && role !== 'CourseProvider') redirect('/dashboard?denied=1');
  return <AuditLogScreen role={role} />;
}
