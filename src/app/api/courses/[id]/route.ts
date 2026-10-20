import { assertObjectId, ok, parseBody, withAuth } from '@/server/http';
import { CourseUpdate } from '@/schemas/course';
import { deleteCourse, getCourse, updateCourse } from '@/server/services/courses';

type P = { id: string };
const WRITERS = ['CourseProvider', 'Administrator'] as const;

export const GET = withAuth<P>({}, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Course');
  return ok(await getCourse(user, params.id));
});

export const PATCH = withAuth<P>({ roles: WRITERS }, async (req, { user, params }) => {
  assertObjectId(params.id, 'Course');
  const input = await parseBody(req, CourseUpdate);
  return ok(await updateCourse(user, params.id, input));
});

export const DELETE = withAuth<P>({ roles: WRITERS }, async (_req, { user, params }) => {
  assertObjectId(params.id, 'Course');
  await deleteCourse(user, params.id);
  return ok({ id: params.id, deleted: true });
});
