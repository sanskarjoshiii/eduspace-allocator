import type { Metadata } from 'next';
import { CourseScreen } from '@/components/courses/course-screen';

export const metadata: Metadata = { title: 'Course' };

/** /courses/[id]: edit for the owner and Administrators, read-only detail for others. */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CourseScreen id={id} />;
}
