import { Types } from 'mongoose';
import {
  Allocation, AllocationRun, Area, AttendanceRecord, Course, CourseOffering, Enrollment, LearningRequest, Partner, Schedule, SocialImpact, Space, User,
} from '@/server/models';
import { BOOKING_ALLOCATION_STATUSES, type AllocationStatus } from '@/lib/domain';
import { toMinutes } from '@/lib/utils';
import { badRequest } from '@/server/http';
import type { ImpactMetrics, ImpactResponse, ImpactSnapshotDto, PublicImpactDto, SdgGoal, SdgResponse } from '@/server/dto/impact';
import { round1, round3 } from './insights';

/** Allocations whose accepted learners count as served. */
export const SERVED_ALLOCATION_STATUSES: readonly AllocationStatus[] = ['Scheduled', 'Active', 'Completed'];
/** Allocations that give a provider a venue and put a space to use. */
export const VENUE_ALLOCATION_STATUSES: readonly AllocationStatus[] = ['ConfirmedByProvider', 'Scheduled', 'Active', 'Completed'];

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Current month in Asia/Kolkata as "YYYY-MM". */
export function currentPeriod(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}

/** [start, end) of a "YYYY-MM" period in Asia/Kolkata. */
export function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start: new Date(`${period}-01T00:00:00+05:30`), end: new Date(`${next}-01T00:00:00+05:30`) };
}

const hoursOf = (w: { startTime: string; endTime: string }) => Math.max(0, toMinutes(w.endTime) - toMinutes(w.startTime)) / 60;

/**
 * Impact metrics from the underlying records. State metrics (learners, providers, spaces,
 * areas, partners, utilisation) are as of now; session metrics (sessions, learning hours)
 * count the schedules dated inside the period.
 */
export async function computeImpactMetrics(period: string): Promise<ImpactMetrics> {
  const { start, end } = periodBounds(period);

  const served = await Allocation.find({ status: { $in: SERVED_ALLOCATION_STATUSES } }).select('_id').lean();
  const servedIds = served.map((a) => a._id);
  const accepted = await Enrollment.find({ allocationId: { $in: servedIds }, status: 'Accepted' })
    .select('learnerUserId requestId distanceKm allocationId')
    .lean();
  const learnersServed = new Set(accepted.map((e) => e.learnerUserId.toString())).size;

  const requestAreas = await LearningRequest.find({ _id: { $in: accepted.map((e) => e.requestId) } }).select('areaId').lean();
  const areaIds = [...new Set(requestAreas.map((r) => r.areaId.toString()))];
  const highDemandAreasServed = await Area.countDocuments({ _id: { $in: areaIds.map((id) => new Types.ObjectId(id)) }, demandLevel: 'High' });

  // Average distance over every accepted enrollment that recorded one.
  const [dist] = await Enrollment.aggregate<{ avg: number | null }>([
    { $match: { status: 'Accepted', distanceKm: { $ne: null } } },
    { $group: { _id: null, avg: { $avg: '$distanceKm' } } },
  ]);

  const venue = await Allocation.find({ status: { $in: VENUE_ALLOCATION_STATUSES } }).select('providerUserId spaceId').lean();
  const providersWithVenue = new Set(venue.map((a) => a.providerUserId.toString())).size;
  const spacesUsed = new Set(venue.map((a) => a.spaceId.toString())).size;

  // Sessions in the period and the learning hours they delivered.
  const schedules = await Schedule.find({ date: { $gte: start, $lt: end }, status: { $in: ['Planned', 'Held'] } })
    .select('_id allocationId date startTime endTime status')
    .lean();
  const scheduleAllocIds = [...new Set(schedules.map((s) => s.allocationId.toString()))].map((id) => new Types.ObjectId(id));
  const [acceptedPerAlloc, presentPerSchedule] = await Promise.all([
    Enrollment.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { allocationId: { $in: scheduleAllocIds }, status: 'Accepted' } },
      { $group: { _id: '$allocationId', n: { $sum: 1 } } },
    ]),
    AttendanceRecord.aggregate<{ _id: Types.ObjectId; marked: number; present: number }>([
      { $match: { scheduleId: { $in: schedules.map((s) => s._id) } } },
      { $group: { _id: '$scheduleId', marked: { $sum: 1 }, present: { $sum: { $cond: ['$present', 1, 0] } } } },
    ]),
  ]);
  const acceptedBy = new Map(acceptedPerAlloc.map((a) => [a._id.toString(), a.n]));
  const presentBy = new Map(presentPerSchedule.map((p) => [p._id.toString(), p]));
  let learningHours = 0;
  for (const s of schedules) {
    const att = presentBy.get(s._id.toString());
    const learners = s.status === 'Held' && att && att.marked > 0 ? att.present : acceptedBy.get(s.allocationId.toString()) ?? 0;
    learningHours += hoursOf(s) * learners;
  }

  // Weekly booked hours vs weekly open slot hours on active spaces.
  const booked = await Allocation.find({ status: { $in: BOOKING_ALLOCATION_STATUSES } }).select('session').lean();
  const idleHoursUsed = booked.reduce((h, a) => h + hoursOf(a.session), 0);
  const activeSpaces = await Space.find({ isActive: true }).select('ownerUserId slots').lean();
  const openHours = activeSpaces.reduce((h, sp) => h + sp.slots.filter((sl) => !sl.isBlocked).reduce((x, sl) => x + hoursOf(sl), 0), 0);

  const activeOwnerIds = [...new Set(activeSpaces.map((s) => s.ownerUserId.toString()))].map((id) => new Types.ObjectId(id));
  const activeSpaceGivers = await User.countDocuments({ _id: { $in: activeOwnerIds }, role: 'SpaceGiver', status: 'Active' });
  const providerIds = (await CourseOffering.distinct('providerUserId', { status: { $in: ['Open', 'Allocated', 'Active'] } })) as Types.ObjectId[];
  const activeProviders = await User.countDocuments({ _id: { $in: providerIds }, role: 'CourseProvider', status: 'Active' });
  const ngoPartners = await Partner.countDocuments({ type: { $in: ['SpaceGiverOrg', 'ProviderOrg'] } });

  return {
    learnersServed,
    learningHours: round1(learningHours),
    providersWithVenue,
    sessionsScheduled: schedules.length,
    spacesUsed,
    idleHoursUsed: round1(idleHoursUsed),
    areasReached: areaIds.length,
    highDemandAreasServed,
    avgDistanceKm: round1(dist?.avg ?? 0),
    spaceUtilisation: openHours > 0 ? round3(Math.min(1, idleHoursUsed / openHours)) : 0,
    activeSpaceGivers,
    activeProviders,
    ngoPartners,
  };
}

/** Computes and stores the SocialImpact snapshot for a period (default: current month, Asia/Kolkata). Called nightly. */
export async function computeImpactSnapshot(period?: string): Promise<void> {
  const p = period ?? currentPeriod();
  if (!PERIOD.test(p)) throw badRequest('Period must look like YYYY-MM.');
  const metrics = await computeImpactMetrics(p);
  await SocialImpact.updateOne({ period: p }, { $set: { metrics, computedAt: new Date() } }, { upsert: true });
}

function toSnapshotDto(doc: { period: string; metrics?: Partial<ImpactMetrics> | null; computedAt?: Date | null }, stored: boolean): ImpactSnapshotDto {
  const m = doc.metrics ?? {};
  return {
    period: doc.period,
    metrics: {
      learnersServed: m.learnersServed ?? 0,
      learningHours: m.learningHours ?? 0,
      providersWithVenue: m.providersWithVenue ?? 0,
      sessionsScheduled: m.sessionsScheduled ?? 0,
      spacesUsed: m.spacesUsed ?? 0,
      idleHoursUsed: m.idleHoursUsed ?? 0,
      areasReached: m.areasReached ?? 0,
      highDemandAreasServed: m.highDemandAreasServed ?? 0,
      avgDistanceKm: m.avgDistanceKm ?? 0,
      spaceUtilisation: m.spaceUtilisation ?? 0,
      activeSpaceGivers: m.activeSpaceGivers ?? 0,
      activeProviders: m.activeProviders ?? 0,
      ngoPartners: m.ngoPartners ?? 0,
    },
    computedAt: new Date(doc.computedAt ?? Date.now()).toISOString(),
    stored,
  };
}

/** Latest snapshot (computed on request when none is stored yet) plus up to 12 months of history. */
export async function getImpact(): Promise<ImpactResponse> {
  const docs = await SocialImpact.find().sort({ period: -1 }).limit(12).lean();
  const history = docs.map((d) => toSnapshotDto(d as never, true)).reverse();
  const latest = history.at(-1) ?? (await liveSnapshot());
  return { latest, history };
}

async function liveSnapshot(): Promise<ImpactSnapshotDto> {
  const period = currentPeriod();
  return toSnapshotDto({ period, metrics: await computeImpactMetrics(period), computedAt: new Date() }, false);
}

/** The six SDGs (README 20) with indicators from the latest snapshot plus live counts. */
export async function getSdg(): Promise<SdgResponse> {
  const { latest } = await getImpact();
  const m = latest.metrics;
  const [spacesTotal, coursesTotal, tutors, lastRun] = await Promise.all([
    Space.countDocuments({ isActive: true }),
    Course.countDocuments(),
    Partner.countDocuments({ type: 'IndividualTutor' }),
    AllocationRun.findOne({ status: 'Completed' }).sort({ finishedAt: -1 }).select('metrics baselineMetrics').lean(),
  ]);
  const runM = (lastRun?.metrics ?? null) as { avgDistanceKm?: number } | null;
  const baseM = (lastRun?.baselineMetrics ?? null) as { avgDistanceKm?: number } | null;
  const distanceSaved = runM?.avgDistanceKm !== undefined && baseM?.avgDistanceKm !== undefined ? round1(baseM.avgDistanceKm - runM.avgDistanceKm) : 0;

  const goals: SdgGoal[] = [
    { goal: 4, title: 'Quality Education', indicators: [
      { key: 'learnersServed', label: 'Learners served', value: m.learnersServed, unit: 'count', source: 'snapshot' },
      { key: 'learningHours', label: 'Learning hours delivered', value: m.learningHours, unit: 'hours', source: 'snapshot' },
    ] },
    { goal: 8, title: 'Decent Work and Economic Growth', indicators: [
      { key: 'providersWithVenue', label: 'Course providers and tutors with a venue', value: m.providersWithVenue, unit: 'count', source: 'snapshot' },
      { key: 'sessionsScheduled', label: 'Sessions scheduled', value: m.sessionsScheduled, unit: 'count', source: 'snapshot' },
    ] },
    { goal: 9, title: 'Industry, Innovation and Infrastructure', indicators: [
      { key: 'spacesUsed', label: 'Idle spaces put to use', value: m.spacesUsed, unit: 'count', source: 'snapshot' },
      { key: 'idleHoursUsed', label: 'Idle hours put to use each week', value: m.idleHoursUsed, unit: 'hours', source: 'snapshot' },
      { key: 'spacesRegistered', label: 'Active spaces registered', value: spacesTotal, unit: 'count', source: 'live' },
    ] },
    { goal: 10, title: 'Reduced Inequalities', indicators: [
      { key: 'areasReached', label: 'Areas reached', value: m.areasReached, unit: 'count', source: 'snapshot' },
      { key: 'highDemandAreasServed', label: 'High-demand areas served', value: m.highDemandAreasServed, unit: 'count', source: 'snapshot' },
    ] },
    { goal: 11, title: 'Sustainable Cities and Communities', indicators: [
      { key: 'avgDistanceKm', label: 'Average travel distance', value: m.avgDistanceKm, unit: 'km', source: 'snapshot' },
      { key: 'distanceReducedKm', label: 'Travel distance reduced against nearest-space allocation', value: distanceSaved, unit: 'km', source: 'live' },
      { key: 'spaceUtilisation', label: 'Space utilisation', value: m.spaceUtilisation, unit: 'ratio', source: 'snapshot' },
    ] },
    { goal: 17, title: 'Partnerships for the Goals', indicators: [
      { key: 'activeSpaceGivers', label: 'Active Space Givers', value: m.activeSpaceGivers, unit: 'count', source: 'snapshot' },
      { key: 'activeProviders', label: 'Active Course Providers', value: m.activeProviders, unit: 'count', source: 'snapshot' },
      { key: 'ngoPartners', label: 'Partner organisations', value: m.ngoPartners, unit: 'count', source: 'snapshot' },
      { key: 'coursesListed', label: 'Courses listed', value: coursesTotal, unit: 'count', source: 'live' },
      { key: 'individualTutors', label: 'Individual tutors', value: tutors, unit: 'count', source: 'live' },
    ] },
  ];
  return { period: latest.period, computedAt: latest.computedAt, goals };
}

/** Headline numbers for the public impact page. Aggregates only. */
export async function getPublicImpact(): Promise<PublicImpactDto> {
  const { latest } = await getImpact();
  const m = latest.metrics;
  return {
    period: latest.period,
    learnersServed: m.learnersServed,
    learningHours: m.learningHours,
    sessionsScheduled: m.sessionsScheduled,
    spacesUsed: m.spacesUsed,
    areasReached: m.areasReached,
    activeSpaceGivers: m.activeSpaceGivers,
    activeProviders: m.activeProviders,
    ngoPartners: m.ngoPartners,
    computedAt: latest.computedAt,
  };
}
