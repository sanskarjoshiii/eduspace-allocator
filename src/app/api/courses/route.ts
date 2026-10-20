import { created, ok, parseBody, parseQuery, withAuth } from '@/server/http';
import { CourseInput, CourseListQuery } from '@/schemas/course';
import { createCourse, listCourses } from '@/server/services/courses';

export const GET = withAuth({}, async (req, { user }) => {
  const query = parseQuery(req, CourseListQuery);
  return ok(await listCourses(user, query));
});

export const POST = withAuth({ roles: ['CourseProvider', 'Administrator'] }, async (req, { user }) => {
  const input = await parseBody(req, CourseInput);
  return created(await createCourse(user, input));
});
