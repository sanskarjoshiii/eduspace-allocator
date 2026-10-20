import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CoursesList } from '@/components/courses/courses-list';

export const metadata: Metadata = { title: 'Courses' };

/** /courses: own courses (Course Provider), every course (Administrator), catalogue (others). */
export default async function CoursesPage() {
  const session = await auth();
  if (!session?.user?.role) redirect('/login');
  return <CoursesList role={session.user.role} />;
}
