import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CourseForm } from '@/components/courses/course-form';

export const metadata: Metadata = { title: 'Add Course' };

/** /courses/new: Course Providers and Administrators. */
export default async function NewCoursePage() {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  if (role !== 'CourseProvider' && role !== 'Administrator') redirect('/courses');
  return <CourseForm isAdmin={role === 'Administrator'} />;
}
