import { Types } from 'mongoose';
import { created, ok, parseBody, parseQuery, withAuth } from '@/server/http';
import { AttendanceInput, AttendanceQuery } from '@/schemas/attendance';
import { attendanceReport, recordAttendance } from '@/server/services/attendance';

/** GET /api/attendance?allocationId=: per-session counts; per-learner rates for providers and administrators. */
export const GET = withAuth({ roles: ['Administrator', 'CourseProvider', 'SpaceGiver'] }, async (req, { user }) => {
  const { allocationId } = parseQuery(req, AttendanceQuery);
  return ok(await attendanceReport(user, new Types.ObjectId(allocationId)));
});

/** POST /api/attendance: mark one session (provider owning the allocation, or administrator). */
export const POST = withAuth({ roles: ['Administrator', 'CourseProvider'] }, async (req, { user }) => {
  const input = await parseBody(req, AttendanceInput);
  return created(await recordAttendance(user, input));
});
