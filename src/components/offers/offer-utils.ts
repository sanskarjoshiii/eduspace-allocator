import type { MyEnrollmentDto } from '@/server/dto/enrollment';
import type { ScheduleDto } from '@/server/dto/schedule';
import type { FeedbackDto, FeedbackList } from '@/server/services/feedback';

export type { MyEnrollmentDto, ScheduleDto, FeedbackDto, FeedbackList };

export const offerKeys = {
  mine: ['enrollments', 'mine'] as const,
  schedules: ['schedules', 'mine'] as const,
  feedback: ['feedback', 'mine'] as const,
};

/** "1 day 4 h", "3 h 12 min", "8 min"; null once passed. */
export function timeLeft(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'} ${hours} h`;
  if (hours > 0) return `${hours} h ${mins} min`;
  return `${Math.max(mins, 1)} min`;
}

/** Today's IST calendar date as YYYY-MM-DD (schedules use IST dates). */
export function todayIst(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/** Group order on the Offers page. */
export const OFFER_GROUPS: { key: string; title: string; description: string; statuses: MyEnrollmentDto['status'][] }[] = [
  { key: 'offered', title: 'Waiting For You', description: 'Seats held for you. Accept before the hold ends.', statuses: ['Offered'] },
  { key: 'accepted', title: 'Your Classes', description: 'Classes you accepted, with upcoming sessions.', statuses: ['Accepted'] },
  { key: 'waitlisted', title: 'Waitlist', description: 'Classes that are full. We offer you a seat as soon as one frees up.', statuses: ['Waitlisted'] },
  { key: 'proposed', title: 'Being Arranged', description: 'Seats held while the space and course provider confirm the class.', statuses: ['Proposed'] },
  { key: 'past', title: 'Past Offers', description: 'Offers you declined, that expired or were cancelled.', statuses: ['Declined', 'Expired', 'Cancelled'] },
];
