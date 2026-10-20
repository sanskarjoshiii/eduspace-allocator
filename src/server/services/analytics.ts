import { Types } from 'mongoose';
import {
  Allocation, AllocationRun, Area, AttendanceRecord, Course, CourseCategory, CourseOffering, DemandInsight, Enrollment, FacilityIssue,
  FacilityType, Feedback, LearningRequest, Schedule, Space, User,
} from '@/server/models';
import {
  BOOKING_ALLOCATION_STATUSES, SEAT_HOLDING_ENROLLMENT_STATUSES, type AllocationStatus, type RequestStatus,
} from '@/lib/domain';
import { formatWindow } from '@/lib/format';
import { forbidden } from '@/server/http';
import type { SessionUser } from '@/server/auth/session';
import type {
  AdminDashboard, AdminKpis, AnalyticsResponse, DashboardResponse, FacilityAlertDto, HighDemandArea, LearnerDashboard, LearnerRequestCard,
  OpenIssueDto, PendingApprovalDto, PendingOfferDto, ProviderAnalytics, ProviderDashboard, SpaceGiverAnalytics, SpaceGiverDashboard,
  SpaceUsageRow, TimelineStep, UnmatchedRequestDto, UpcomingSessionDto, WeekPoint, WeekdayUsage,
} from '@/server/dto/analytics';
import { getSettings } from './settings';
import { areaTotals, haversineKm, pointOf, round1, round3 } from './insights';
import { getMap, slotUsage } from './map';
import { getImpact } from './impact';
import { discoverFor } from './recommendations';

const LIVE_ALLOCATION_STATUSES: readonly AllocationStatus[] = ['Proposed', ...BOOKING_ALLOCATION_STATUSES];
const PLACED_REQUEST_STATUSES: readonly RequestStatus[] = ['Matched', 'Waitlisted', 'Offered', 'Accepted', 'Scheduled', 'Active', 'Completed'];
const DAY_MS = 86_400_000;

const countBy = async (model: typeof LearningRequest | typeof Allocation | typeof CourseOffering, match: Record<string, unknown>) => {
  const rows = await (model as typeof LearningRequest).aggregate<{ _id: string; n: number }>([
    { $match: match },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n])) as Record<string, number>;
};

const ratio = (a: number, b: number) => (b > 0 ? round3(a / b) : 0);

// ---- Scope resolution ----

export interface AnalyticsScopeQuery {
  scope?: 'global' | 'SpaceGiver' | 'CourseProvider';
  ownerId?: string;
}

/**
 * Analytics for the caller's scope. Administrators get global KPIs, or a Space Giver's or
 * Course Provider's view with ?scope=&ownerId=. Everyone else gets their own scope; asking
 * for another owner's data is a 403. Learners have no analytics.
 */
export async function analyticsFor(user: SessionUser, q: AnalyticsScopeQuery): Promise<AnalyticsResponse> {
  if (user.role === 'Learner') throw forbidden('Analytics are not available for learners.');
  if (user.role !== 'Administrator') {
    if (q.ownerId && q.ownerId !== user.id) throw forbidden('You can only see analytics for your own records.');
    return user.role === 'SpaceGiver' ? spaceGiverAnalytics(user.id) : providerAnalytics(user.id);
  }
  if (q.scope === 'SpaceGiver' || q.scope === 'CourseProvider') {
    if (!q.ownerId) return { scope: 'Administrator', kpis: await adminKpis() };
    const owner = await User.findById(q.ownerId).select('role').lean();
    if (!owner || owner.role !== q.scope) throw forbidden('That user does not have this role.');
    return q.scope === 'SpaceGiver' ? spaceGiverAnalytics(q.ownerId) : providerAnalytics(q.ownerId);
  }
  return { scope: 'Administrator', kpis: await adminKpis() };
}

// ---- Administrator ----

export async function adminKpis(): Promise<AdminKpis> {
  const since30 = new Date(Date.now() - 30 * DAY_MS);
  const [requestsByStatus, allocationsByStatus, runsRows, facilityAlertsOpen] = await Promise.all([
    countBy(LearningRequest, {}),
    countBy(Allocation, {}),
    AllocationRun.aggregate<{ _id: string; n: number }>([{ $match: { createdAt: { $gte: since30 } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    FacilityIssue.countDocuments({ status: 'Open' }),
  ]);
  const requestsTotal = Object.values(requestsByStatus).reduce((a, b) => a + b, 0);
  const denominator = requestsTotal - (requestsByStatus.Cancelled ?? 0);
  const placed = PLACED_REQUEST_STATUSES.reduce((n, s) => n + (requestsByStatus[s] ?? 0), 0);

  const [dist] = await Enrollment.aggregate<{ avg: number | null }>([
    { $match: { status: { $in: SEAT_HOLDING_ENROLLMENT_STATUSES }, distanceKm: { $ne: null } } },
    { $group: { _id: null, avg: { $avg: '$distanceKm' } } },
  ]);
  const waitlistedRequests = (await Enrollment.distinct('requestId', { status: 'Waitlisted' })).length;

  // Seat utilisation over offerings with a live allocation.
  const liveOfferingIds = (await Allocation.distinct('offeringId', { status: { $in: LIVE_ALLOCATION_STATUSES } })) as Types.ObjectId[];
  const [seatsOffered] = await CourseOffering.aggregate<{ n: number }>([
    { $match: { _id: { $in: liveOfferingIds } } },
    { $group: { _id: null, n: { $sum: '$batchSize' } } },
  ]);
  const seatsHeld = await Enrollment.countDocuments({ offeringId: { $in: liveOfferingIds }, status: { $in: SEAT_HOLDING_ENROLLMENT_STATUSES } });

  const hours = await spaceHours({});
  const runsByStatusLast30Days = Object.fromEntries(runsRows.map((r) => [r._id, r.n]));

  return {
    requestsTotal,
    requestsByStatus,
    coverageRate: ratio(placed, denominator),
    avgDistanceKm: round1(dist?.avg ?? 0),
    seatUtilisation: ratio(seatsHeld, seatsOffered?.n ?? 0),
    spaceUtilisationHours: hours.bookedHours,
    spaceOpenHours: hours.openHours,
    waitlistRate: ratio(waitlistedRequests, denominator),
    runsLast30Days: runsRows.reduce((a, r) => a + r.n, 0),
    runsByStatusLast30Days,
    unmatchedCount: requestsByStatus.Unmatched ?? 0,
    facilityAlertsOpen,
    allocationsByStatus,
    trend: await weeklyTrend(12),
  };
}

/** Monday 00:00 UTC of the week containing d. */
function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - day * DAY_MS);
}

async function weeklyTrend(weeks: number): Promise<WeekPoint[]> {
  const first = weekStart(new Date(Date.now() - (weeks - 1) * 7 * DAY_MS));
  const bucket = { $dateTrunc: { date: '$createdAt', unit: 'week', startOfWeek: 'monday', timezone: 'UTC' } };
  const [reqs, allocs, filled] = await Promise.all([
    LearningRequest.aggregate<{ _id: Date; n: number }>([{ $match: { createdAt: { $gte: first } } }, { $group: { _id: bucket, n: { $sum: 1 } } }]),
    Allocation.aggregate<{ _id: Date; n: number }>([
      { $match: { createdAt: { $gte: first }, status: { $in: LIVE_ALLOCATION_STATUSES.concat(['Completed']) } } },
      { $lookup: { from: CourseOffering.collection.name, localField: 'offeringId', foreignField: '_id', as: 'o' } },
      { $unwind: '$o' },
      { $group: { _id: bucket, n: { $sum: '$o.batchSize' } } },
    ]),
    Enrollment.aggregate<{ _id: Date; n: number }>([
      { $match: { createdAt: { $gte: first }, status: 'Accepted' } },
      { $group: { _id: bucket, n: { $sum: 1 } } },
    ]),
  ]);
  const key = (d: Date) => new Date(d).toISOString().slice(0, 10);
  const r = new Map(reqs.map((x) => [key(x._id), x.n]));
  const a = new Map(allocs.map((x) => [key(x._id), x.n]));
  const f = new Map(filled.map((x) => [key(x._id), x.n]));
  return Array.from({ length: weeks }, (_, i) => {
    const k = key(new Date(first.getTime() + i * 7 * DAY_MS));
    return { week: k, requests: r.get(k) ?? 0, seatsOffered: a.get(k) ?? 0, seatsFilled: f.get(k) ?? 0 };
  });
}

/** Weekly open and booked hours for spaces matching a filter, per space and per weekday. */
async function spaceHours(filter: Record<string, unknown>): Promise<{ rows: SpaceUsageRow[]; byWeekday: WeekdayUsage[]; openHours: number; bookedHours: number }> {
  const spaces = await Space.find(filter).select('name isActive seatCapacity slots').lean();
  const bookings = await Allocation.find({ spaceId: { $in: spaces.map((s) => s._id) }, status: { $in: BOOKING_ALLOCATION_STATUSES } })
    .select('spaceId session')
    .lean();
  const byWeekday: WeekdayUsage[] = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, openHours: 0, bookedHours: 0 }));
  const rows: SpaceUsageRow[] = spaces.map((s) => {
    const mine = bookings.filter((b) => b.spaceId.toString() === s._id.toString()).map((b) => b.session);
    const slots = s.isActive ? s.slots : [];
    const u = slotUsage(slots, mine);
    for (const day of byWeekday) {
      const d = slotUsage(slots.filter((sl) => sl.dayOfWeek === day.dayOfWeek), mine);
      day.openHours = round1(day.openHours + d.openHours);
      day.bookedHours = round1(day.bookedHours + d.bookedHours);
    }
    return {
      spaceId: s._id.toString(),
      spaceName: s.name,
      isActive: s.isActive,
      seatCapacity: s.seatCapacity,
      openHours: u.openHours,
      bookedHours: u.bookedHours,
      unusedHours: u.freeHours,
      utilisation: ratio(u.bookedHours, u.openHours),
    };
  });
  const openHours = round1(rows.reduce((a, r) => a + r.openHours, 0));
  const bookedHours = round1(rows.reduce((a, r) => a + r.bookedHours, 0));
  return { rows, byWeekday, openHours, bookedHours };
}

// ---- Space Giver ----

export async function spaceGiverAnalytics(ownerId: string): Promise<SpaceGiverAnalytics> {
  const owner = new Types.ObjectId(ownerId);
  const hours = await spaceHours({ ownerUserId: owner });
  const spaceIds = hours.rows.map((r) => new Types.ObjectId(r.spaceId));
  const today = startOfTodayIst();
  const [upcomingSessions, pendingApprovals, sessionsHeld, issuesOpen] = await Promise.all([
    Schedule.countDocuments({ spaceId: { $in: spaceIds }, date: { $gte: today }, status: 'Planned' }),
    Allocation.countDocuments({ spaceOwnerUserId: owner, status: 'Proposed' }),
    Schedule.countDocuments({ spaceId: { $in: spaceIds }, status: 'Held' }),
    FacilityIssue.countDocuments({ spaceId: { $in: spaceIds }, status: 'Open' }),
  ]);
  return {
    scope: 'SpaceGiver',
    ownerId,
    spaces: hours.rows,
    byWeekday: hours.byWeekday,
    totals: {
      openHours: hours.openHours,
      bookedHours: hours.bookedHours,
      unusedHours: round1(hours.openHours - hours.bookedHours),
      utilisation: ratio(hours.bookedHours, hours.openHours),
    },
    upcomingSessions,
    pendingApprovals,
    sessionsHeld,
    issuesOpen,
  };
}

/** Midnight today in Asia/Kolkata, as a UTC Date (how Schedule.date is stored). */
function startOfTodayIst(): Date {
  const ist = new Date(Date.now() + 5.5 * 3_600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3_600_000);
}

// ---- Course Provider ----

async function providerCategoryIds(owner: Types.ObjectId): Promise<Types.ObjectId[]> {
  const [fromCourses, fromOfferings] = await Promise.all([
    Course.distinct('categoryId', { providerUserId: owner }),
    CourseOffering.distinct('categoryId', { providerUserId: owner }),
  ]);
  return [...new Set([...fromCourses, ...fromOfferings].map(String))].map((id) => new Types.ObjectId(id));
}

/** High-demand areas (aggregated DemandInsight rows) for a set of categories. */
async function highDemandAreasFor(categoryIds: Types.ObjectId[], limit = 10): Promise<HighDemandArea[]> {
  if (categoryIds.length === 0) return [];
  const rows = await DemandInsight.find({ categoryId: { $in: categoryIds }, level: { $in: ['High', 'Medium'] } })
    .sort({ gap: -1, demand: -1 })
    .limit(limit)
    .lean();
  const [areas, cats] = await Promise.all([
    Area.find({ _id: { $in: rows.map((r) => r.areaId) } }).select('name center').lean(),
    CourseCategory.find({ _id: { $in: rows.map((r) => r.categoryId) } }).select('name').lean(),
  ]);
  return rows.map((r) => {
    const a = areas.find((x) => x._id.toString() === r.areaId.toString());
    return {
      areaId: r.areaId.toString(),
      areaName: a?.name ?? '',
      areaCenter: pointOf(a?.center),
      categoryId: r.categoryId.toString(),
      categoryName: cats.find((c) => c._id.toString() === r.categoryId.toString())?.name ?? '',
      level: r.level,
      demand: r.demand,
      seatsOffered: r.seatsOffered,
      gap: r.gap,
    };
  });
}

async function attendanceRateFor(allocationFilter: Record<string, unknown>): Promise<number | null> {
  const ids = (await Allocation.find(allocationFilter).select('_id').lean()).map((a) => a._id);
  const [agg] = await AttendanceRecord.aggregate<{ marked: number; present: number }>([
    { $match: { allocationId: { $in: ids } } },
    { $group: { _id: null, marked: { $sum: 1 }, present: { $sum: { $cond: ['$present', 1, 0] } } } },
  ]);
  return agg && agg.marked > 0 ? round3(agg.present / agg.marked) : null;
}

export async function providerAnalytics(ownerId: string): Promise<ProviderAnalytics> {
  const owner = new Types.ObjectId(ownerId);
  const offerings = await CourseOffering.find({ providerUserId: owner }).select('_id status batchSize').lean();
  const offeringIds = offerings.map((o) => o._id);
  const offeringsByStatus: Record<string, number> = {};
  for (const o of offerings) offeringsByStatus[o.status] = (offeringsByStatus[o.status] ?? 0) + 1;
  const seatsOffered = offerings.filter((o) => o.status !== 'Draft' && o.status !== 'Cancelled').reduce((a, o) => a + o.batchSize, 0);
  const accepted = await Enrollment.find({ offeringId: { $in: offeringIds }, status: 'Accepted' }).select('learnerUserId').lean();
  const [rating] = await Feedback.aggregate<{ avg: number; n: number }>([
    { $match: { offeringId: { $in: offeringIds } } },
    { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
  ]);
  return {
    scope: 'CourseProvider',
    ownerId,
    offeringsByStatus,
    seatsOffered,
    seatsFilled: accepted.length,
    acceptedLearners: new Set(accepted.map((e) => e.learnerUserId.toString())).size,
    attendanceRate: await attendanceRateFor({ providerUserId: owner }),
    averageRating: rating ? Math.round(rating.avg * 100) / 100 : null,
    ratingsCount: rating?.n ?? 0,
    highDemandAreas: await highDemandAreasFor(await providerCategoryIds(owner)),
  };
}

// ---- Dashboards (README 17) ----

export async function dashboardFor(user: SessionUser): Promise<DashboardResponse> {
  switch (user.role) {
    case 'Administrator':
      return adminDashboard();
    case 'Learner':
      return learnerDashboard(user);
    case 'SpaceGiver':
      return spaceGiverDashboard(user);
    case 'CourseProvider':
      return providerDashboard(user);
  }
}

async function adminDashboard(): Promise<AdminDashboard> {
  const [kpis, run, unmatched, issues, demandByArea, impact] = await Promise.all([
    adminKpis(),
    AllocationRun.findOne().sort({ createdAt: -1 }).lean(),
    LearningRequest.find({ status: 'Unmatched' }).sort({ createdAt: 1 }).limit(5).select('learnerUserId categoryId areaId status createdAt suggestions').lean(),
    FacilityIssue.find({ status: 'Open' }).sort({ createdAt: -1 }).limit(5).lean(),
    areaTotals(),
    getImpact(),
  ]);
  const [learners, cats, areas, spaces, facilityTypes] = await Promise.all([
    User.find({ _id: { $in: unmatched.map((r) => r.learnerUserId) } }).select('name').lean(),
    CourseCategory.find({ _id: { $in: unmatched.map((r) => r.categoryId) } }).select('name').lean(),
    Area.find({ _id: { $in: unmatched.map((r) => r.areaId) } }).select('name').lean(),
    Space.find({ _id: { $in: issues.map((i) => i.spaceId) } }).select('name').lean(),
    FacilityType.find({ _id: { $in: issues.map((i) => i.facilityTypeId) } }).select('name').lean(),
  ]);
  const nameOf = (list: { _id: Types.ObjectId; name: string }[], id: Types.ObjectId) => list.find((x) => x._id.toString() === id.toString())?.name ?? '';
  const unmatchedRequests: UnmatchedRequestDto[] = unmatched.map((r) => ({
    id: r._id.toString(),
    learnerName: nameOf(learners, r.learnerUserId),
    categoryName: nameOf(cats, r.categoryId),
    areaName: nameOf(areas, r.areaId),
    status: r.status,
    createdAt: new Date(r.createdAt).toISOString(),
    topSuggestion: r.suggestions[0]?.reasons[0] ?? null,
  }));
  const facilityAlerts: FacilityAlertDto[] = issues.map((i) => ({
    id: i._id.toString(),
    spaceId: i.spaceId.toString(),
    spaceName: nameOf(spaces, i.spaceId),
    facilityName: nameOf(facilityTypes, i.facilityTypeId),
    affectedQuantity: i.affectedQuantity,
    affectedAllocations: i.affectedAllocationIds.length,
    createdAt: new Date(i.createdAt).toISOString(),
  }));
  return {
    role: 'Administrator',
    kpis,
    latestRun: run
      ? {
          id: run._id.toString(),
          status: run.status,
          trigger: run.trigger,
          strategy: run.strategy,
          startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
          finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
          metrics: run.metrics ?? null,
          baselineMetrics: run.baselineMetrics ?? null,
          counts: run.counts ?? null,
          error: run.error ?? '',
        }
      : null,
    unmatchedRequests,
    facilityAlerts,
    demandByArea: demandByArea.slice(0, 10),
    utilisation: {
      bookedHours: kpis.spaceUtilisationHours,
      openHours: kpis.spaceOpenHours,
      ratio: ratio(kpis.spaceUtilisationHours, kpis.spaceOpenHours),
      seatUtilisation: kpis.seatUtilisation,
    },
    impact: { period: impact.latest.period, metrics: impact.latest.metrics, computedAt: impact.latest.computedAt },
  };
}

const TIMELINE: { status: RequestStatus; label: string }[] = [
  { status: 'Submitted', label: 'Submitted' },
  { status: 'Analysed', label: 'Analysed' },
  { status: 'Matched', label: 'Matched' },
  { status: 'Offered', label: 'Offer sent' },
  { status: 'Accepted', label: 'Accepted' },
  { status: 'Scheduled', label: 'Scheduled' },
  { status: 'Active', label: 'In class' },
  { status: 'Completed', label: 'Completed' },
];

/** Timeline position of each status (off-path statuses map to where they happen). */
const TIMELINE_POS: Record<RequestStatus, number> = {
  Submitted: 0, Analysed: 1, Unmatched: 1, Matched: 2, Waitlisted: 2, Offered: 3, Declined: 3, Expired: 3, Accepted: 4, Scheduled: 5,
  Active: 6, Completed: 7, Cancelled: 0,
};
const NOTES: Partial<Record<RequestStatus, string>> = {
  Unmatched: 'No class fits yet. Your request stays open and we will keep looking.',
  Waitlisted: 'You are on the waitlist for a class.',
  Declined: 'You declined the offer.',
  Expired: 'The offer expired.',
  Cancelled: 'This request was cancelled.',
};

export function requestTimeline(status: RequestStatus): TimelineStep[] {
  const pos = TIMELINE_POS[status] ?? 0;
  const finished = status === 'Completed';
  return TIMELINE.map((step, i) => ({
    status: step.status,
    label: step.label,
    state: i < pos || (finished && i === pos) ? 'done' : i === pos ? 'current' : 'upcoming',
  }));
}

async function learnerDashboard(user: SessionUser): Promise<LearnerDashboard> {
  const me = new Types.ObjectId(user.id);
  const [requests, offers] = await Promise.all([
    LearningRequest.find({ learnerUserId: me }).sort({ createdAt: -1 }).limit(10).select('categoryId areaId status createdAt').lean(),
    Enrollment.find({ learnerUserId: me, status: 'Offered' }).sort({ offerExpiresAt: 1 }).lean(),
  ]);
  const [cats, areas] = await Promise.all([
    CourseCategory.find({ _id: { $in: requests.map((r) => r.categoryId) } }).select('name').lean(),
    Area.find({ _id: { $in: requests.map((r) => r.areaId) } }).select('name').lean(),
  ]);
  const cards: LearnerRequestCard[] = requests.map((r) => ({
    id: r._id.toString(),
    categoryName: cats.find((c) => c._id.toString() === r.categoryId.toString())?.name ?? '',
    areaName: areas.find((a) => a._id.toString() === r.areaId.toString())?.name ?? '',
    status: r.status,
    note: NOTES[r.status as RequestStatus] ?? null,
    createdAt: new Date(r.createdAt).toISOString(),
    timeline: requestTimeline(r.status as RequestStatus),
  }));

  const allocs = await Allocation.find({ _id: { $in: offers.map((o) => o.allocationId).filter(Boolean) } }).select('spaceId session').lean();
  const [offerings, spaces] = await Promise.all([
    CourseOffering.find({ _id: { $in: offers.map((o) => o.offeringId) } }).select('title').lean(),
    Space.find({ _id: { $in: allocs.map((a) => a.spaceId) } }).select('name areaId').lean(),
  ]);
  const spaceAreas = await Area.find({ _id: { $in: spaces.map((s) => s.areaId) } }).select('name').lean();
  const pendingOffers: PendingOfferDto[] = offers.map((e) => {
    const al = e.allocationId ? allocs.find((a) => a._id.toString() === e.allocationId!.toString()) : undefined;
    const sp = al ? spaces.find((s) => s._id.toString() === al.spaceId.toString()) : undefined;
    return {
      enrollmentId: e._id.toString(),
      offeringId: e.offeringId.toString(),
      offeringTitle: offerings.find((o) => o._id.toString() === e.offeringId.toString())?.title ?? '',
      spaceName: sp?.name ?? null,
      areaName: sp ? spaceAreas.find((a) => a._id.toString() === sp.areaId.toString())?.name ?? null : null,
      session: al ? formatWindow(al.session) : null,
      distanceKm: e.distanceKm ?? null,
      expiresAt: e.offerExpiresAt ? new Date(e.offerExpiresAt).toISOString() : null,
    };
  });

  const [discover, map] = await Promise.all([discoverFor(user), getMap(user, { layers: ['offers'], availableOnly: false })]);
  return {
    role: 'Learner',
    requests: cards,
    pendingOffers,
    recommended: discover.offerings.slice(0, 3),
    nearbyOffers: map.layers.offers?.length ?? 0,
  };
}

async function spaceGiverDashboard(user: SessionUser): Promise<SpaceGiverDashboard> {
  const me = new Types.ObjectId(user.id);
  const [stats, settings] = await Promise.all([spaceGiverAnalytics(user.id), getSettings()]);
  const spaces = await Space.find({ ownerUserId: me }).select('name location').lean();
  const spaceIds = spaces.map((s) => s._id);
  const spaceName = (id: Types.ObjectId) => spaces.find((s) => s._id.toString() === id.toString())?.name ?? '';

  const [sessions, proposals, issues] = await Promise.all([
    Schedule.find({ spaceId: { $in: spaceIds }, date: { $gte: startOfTodayIst() }, status: 'Planned' }).sort({ date: 1, startTime: 1 }).limit(5).lean(),
    Allocation.find({ spaceOwnerUserId: me, status: 'Proposed' }).sort({ createdAt: 1 }).limit(5).select('offeringId spaceId session score createdAt').lean(),
    FacilityIssue.find({ spaceId: { $in: spaceIds }, status: 'Open' }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  const offerings = await CourseOffering.find({ _id: { $in: [...sessions.map((s) => s.offeringId), ...proposals.map((p) => p.offeringId)] } })
    .select('title')
    .lean();
  const title = (id: Types.ObjectId) => offerings.find((o) => o._id.toString() === id.toString())?.title ?? '';
  const headcounts = await Enrollment.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { allocationId: { $in: proposals.map((p) => p._id) }, status: { $in: SEAT_HOLDING_ENROLLMENT_STATUSES } } },
    { $group: { _id: '$allocationId', n: { $sum: 1 } } },
  ]);
  const facilityTypes = await FacilityType.find({ _id: { $in: issues.map((i) => i.facilityTypeId) } }).select('name').lean();

  const upcomingSessions: UpcomingSessionDto[] = sessions.map((s) => ({
    scheduleId: s._id.toString(),
    date: new Date(s.date).toISOString(),
    startTime: s.startTime,
    endTime: s.endTime,
    spaceName: spaceName(s.spaceId),
    courseTitle: title(s.offeringId),
  }));
  const pendingApprovals: PendingApprovalDto[] = proposals.map((p) => ({
    allocationId: p._id.toString(),
    courseTitle: title(p.offeringId),
    spaceName: spaceName(p.spaceId),
    session: formatWindow(p.session),
    headcount: headcounts.find((h) => h._id.toString() === p._id.toString())?.n ?? 0,
    score: p.score,
    createdAt: new Date(p.createdAt).toISOString(),
  }));
  const openIssues: OpenIssueDto[] = issues.map((i) => ({
    id: i._id.toString(),
    spaceName: spaceName(i.spaceId),
    facilityName: facilityTypes.find((f) => f._id.toString() === i.facilityTypeId.toString())?.name ?? '',
    affectedQuantity: i.affectedQuantity,
    createdAt: new Date(i.createdAt).toISOString(),
  }));

  // Aggregated demand in areas within the radius of any own space.
  const points = spaces.map((s) => pointOf(s.location));
  const nearbyDemand = (await areaTotals())
    .filter((a) => points.some((p) => haversineKm(p, a.areaCenter) <= settings.maxRadiusKm))
    .filter((a) => a.demand > 0 || a.openRequests > 0)
    .slice(0, 5);

  return {
    role: 'SpaceGiver',
    utilisation: { spaces: stats.spaces, byWeekday: stats.byWeekday, totals: stats.totals },
    upcomingSessions,
    pendingApprovals,
    unusedHours: stats.totals.unusedHours,
    nearbyDemand,
    openIssues,
  };
}

async function providerDashboard(user: SessionUser): Promise<ProviderDashboard> {
  const me = new Types.ObjectId(user.id);
  const offerings = await CourseOffering.find({ providerUserId: me, status: { $ne: 'Cancelled' } })
    .sort({ startDate: -1 })
    .limit(20)
    .select('title status batchSize')
    .lean();
  const allocations = await Allocation.find({ offeringId: { $in: offerings.map((o) => o._id) }, status: { $in: LIVE_ALLOCATION_STATUSES.concat(['Completed']) } })
    .sort({ createdAt: -1 })
    .select('offeringId spaceId session status')
    .lean();
  const spaces = await Space.find({ _id: { $in: allocations.map((a) => a.spaceId) } }).select('name areaId').lean();
  const areas = await Area.find({ _id: { $in: spaces.map((s) => s.areaId) } }).select('name').lean();
  const accepted = await Enrollment.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { offeringId: { $in: offerings.map((o) => o._id) }, status: 'Accepted' } },
    { $group: { _id: '$offeringId', n: { $sum: 1 } } },
  ]);
  const stats = await providerAnalytics(user.id);
  return {
    role: 'CourseProvider',
    offerings: offerings.map((o) => {
      const al = allocations.find((a) => a.offeringId.toString() === o._id.toString());
      const sp = al ? spaces.find((s) => s._id.toString() === al.spaceId.toString()) : undefined;
      return {
        offeringId: o._id.toString(),
        title: o.title,
        status: o.status,
        batchSize: o.batchSize,
        acceptedLearners: accepted.find((x) => x._id.toString() === o._id.toString())?.n ?? 0,
        assigned:
          al && sp
            ? {
                allocationId: al._id.toString(),
                allocationStatus: al.status,
                spaceName: sp.name,
                areaName: areas.find((a) => a._id.toString() === sp.areaId.toString())?.name ?? '',
                session: formatWindow(al.session),
              }
            : null,
      };
    }),
    acceptedLearners: stats.acceptedLearners,
    highDemandAreas: stats.highDemandAreas,
    attendanceRate: stats.attendanceRate,
  };
}

