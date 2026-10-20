import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { OfferingForm } from '@/components/offerings/offering-form';

export const metadata: Metadata = { title: 'Add Offering' };

/** /offerings/new[?courseId=]: Course Providers and Administrators. */
export default async function NewOfferingPage({ searchParams }: { searchParams: Promise<{ courseId?: string }> }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  if (role !== 'CourseProvider' && role !== 'Administrator') redirect('/offerings');
  const { courseId } = await searchParams;
  return <OfferingForm isAdmin={role === 'Administrator'} initialCourseId={courseId && /^[a-f\d]{24}$/i.test(courseId) ? courseId : undefined} />;
}
