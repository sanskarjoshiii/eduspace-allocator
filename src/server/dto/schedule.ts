import type { ScheduleStatus } from '@/lib/domain';
import type { ScheduleLean } from '@/server/worker/types';

export interface ScheduleDto {
  id: string;
  allocationId: string;
  offeringId: string;
  courseTitle: string;
  spaceId: string;
  spaceName: string;
  /** IST calendar date, "YYYY-MM-DD". */
  date: string;
  startTime: string;
  endTime: string;
  status: ScheduleStatus;
  note: string;
}

export function toScheduleDto(s: ScheduleLean, courseTitle: string, spaceName: string): ScheduleDto {
  return {
    id: s._id.toString(),
    allocationId: s.allocationId.toString(),
    offeringId: s.offeringId.toString(),
    courseTitle,
    spaceId: s.spaceId.toString(),
    spaceName,
    date: new Date(s.date).toISOString().slice(0, 10),
    startTime: s.startTime,
    endTime: s.endTime,
    status: s.status,
    note: s.note ?? '',
  };
}
