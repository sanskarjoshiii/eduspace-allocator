// Snapshot reader (PLAN 3.11): turns the database into the engine's EngineSnapshot.
// Spaces are prefiltered geographically, so distant spaces never enter the graph.

import { Types } from 'mongoose';
import {
  BOOKING_ALLOCATION_STATUSES,
  OPEN_REQUEST_STATUSES,
  SEAT_HOLDING_ENROLLMENT_STATUSES,
  type AllocationStatus,
  type RequestStatus,
} from '@/lib/domain';
import { toMinutes } from '@/lib/utils';
import { Allocation, Area, Course, CourseCategory, CourseOffering, Enrollment, FacilityType, LearningRequest, Space, StudentDemand } from '@/server/models';
import { activeWeights, getSettings, type Settings } from '@/server/services/settings';
import type {
  DayOfWeek,
  EngineOffering,
  EngineRequest,
  EngineSettings,
  EngineSnapshot,
  EngineSpace,
  GeoPoint,
  TimeWindow,
} from '@/engine/types';
import { ACTIVE_ENROLLMENT_STATUSES } from './lifecycle';
import type { AllocationLean, EnrollmentLean, OfferingLean, RequestLean, SpaceLean, WindowDoc } from './types';

const EARTH_RADIUS_KM = 6378.1;
/** Extra radius around each demand centre, on top of maxRadiusKm and the request spread. */
const PREFILTER_MARGIN_KM = 1;
/** Cap on how far a request may sit from its area centre for the prefilter margin. */
const MAX_SPREAD_KM = 15;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const toPoint = (p: { coordinates: number[] }): GeoPoint => ({ lng: p.coordinates[0] ?? 0, lat: p.coordinates[1] ?? 0 });

export function toTimeWindow(w: WindowDoc): TimeWindow {
  return { dayOfWeek: w.dayOfWeek as DayOfWeek, start: toMinutes(w.startTime), end: toMinutes(w.endTime) };
}

export interface FixedInfo {
  allocationId: string;
  status: AllocationStatus;
  spaceId: string;
  seatsTaken: number;
}

/** Everything publish needs to interpret the engine result against the database. */
export interface SnapshotContext {
  offerings: Map<string, OfferingLean>;
  spaces: Map<string, SpaceLean>;
  /** Offerings whose booked allocation the run must keep. */
  fixed: Map<string, FixedInfo>;
  /** Non-fixed offerings in the snapshot and their current Proposed (re-optimisable) allocations. */
  reoptimisable: Map<string, AllocationLean[]>;
  /** Highest existing waitlist rank per allocation, so new waitlist entries queue behind. */
  maxWaitlistRank: Map<string, number>;
  /** Request id → status when the snapshot was read. */
  requestStatus: Map<string, RequestStatus>;
  /** "offeringId:spaceId" pairs a space already rejected; the run never re-proposes them. */
  rejectedPairs: Set<string>;
}

export interface SnapshotOptions {
  trigger?: string;
  /** Spaces to include regardless of the geographic prefilter. */
  includeSpaceIds?: string[];
  /** Offerings to include even when their allocation is in reallocation. */
  includeOfferingIds?: string[];
  /** Allocations whose own bookings are left out (they are being re-checked or moved). */
  excludeBookingAllocationIds?: string[];
  /** Extra prefilter centres (for example the space of an allocation being re-checked). */
  extraCentres?: GeoPoint[];
  now?: Date;
}

export interface SnapshotBundle {
  snapshot: EngineSnapshot;
  settings: EngineSettings;
  appSettings: Settings;
  ctx: SnapshotContext;
}

export async function engineSettingsFrom(s: Settings): Promise<EngineSettings> {
  return {
    strategy: s.strategy,
    weights: await activeWeights(s),
    maxRadiusKm: s.maxRadiusKm,
    minEdgeScore: s.minEdgeScore,
    seed: s.seed,
    kMin: s.kMin,
    kMax: s.kMax,
    kInits: s.kInits,
    alternativesToKeep: 3,
    suggestionCount: 3,
  };
}

const TERMINAL_ALLOCATION: AllocationStatus[] = ['Rejected', 'Cancelled', 'Superseded', 'Completed'];

/** Builds the snapshot plus the context publish needs. */
export async function buildSnapshotWithContext(opts: SnapshotOptions = {}): Promise<SnapshotBundle> {
  const now = opts.now ?? new Date();
  const appSettings = await getSettings();
  const settings = await engineSettingsFrom(appSettings);
  const includeOfferings = new Set(opts.includeOfferingIds ?? []);
  const excludeBookings = new Set(opts.excludeBookingAllocationIds ?? []);

  const [areas, categories, facilityTypes, baseline] = await Promise.all([
    Area.find().lean(),
    CourseCategory.find().lean(),
    FacilityType.find().lean(),
    StudentDemand.find().lean(),
  ]);
  const areaCentre = new Map(areas.map((a) => [a._id.toString(), toPoint(a.center as { coordinates: number[] })]));

  // ---- Offerings and their allocations ----
  const offeringDocs = await CourseOffering.find({
    $or: [{ status: { $in: ['Open', 'Allocated'] } }, { _id: { $in: [...includeOfferings].map((id) => new Types.ObjectId(id)) } }],
  }).lean<OfferingLean[]>();
  const offeringIds = offeringDocs.map((o) => o._id);
  const allocs = await Allocation.find({ offeringId: { $in: offeringIds }, status: { $nin: TERMINAL_ALLOCATION } }).lean<AllocationLean[]>();
  const rejected = await Allocation.find({ offeringId: { $in: offeringIds }, status: 'Rejected' }).select('offeringId spaceId').lean<AllocationLean[]>();
  const allocsByOffering = new Map<string, AllocationLean[]>();
  for (const a of allocs) {
    const k = a.offeringId.toString();
    allocsByOffering.set(k, [...(allocsByOffering.get(k) ?? []), a]);
  }

  const fixed = new Map<string, FixedInfo>();
  const reoptimisable = new Map<string, AllocationLean[]>();
  const included: OfferingLean[] = [];
  const bookedStatuses: readonly AllocationStatus[] = BOOKING_ALLOCATION_STATUSES.filter((s) => s !== 'NeedsReallocation');
  for (const o of offeringDocs) {
    const id = o._id.toString();
    const list = allocsByOffering.get(id) ?? [];
    const inReallocation = list.some(
      (a) => a.status === 'NeedsReallocation' || (a.replacesAllocationId && (a.status === 'Proposed' || a.status === 'ApprovedBySpace')),
    );
    const booked = list.find((a) => bookedStatuses.includes(a.status)) ?? (includeOfferings.has(id) ? list.find((a) => a.status === 'NeedsReallocation') : undefined);
    if (inReallocation && !includeOfferings.has(id)) continue; // a reallocation proposal is in flight
    if (booked) {
      fixed.set(id, { allocationId: booked._id.toString(), status: booked.status, spaceId: booked.spaceId.toString(), seatsTaken: 0 });
    } else {
      reoptimisable.set(id, list.filter((a) => a.status === 'Proposed' && !a.replacesAllocationId));
    }
    included.push(o);
  }

  // Seats already taken on fixed allocations, and existing waitlist depth.
  const fixedAllocIds = [...fixed.values()].map((f) => new Types.ObjectId(f.allocationId));
  const fixedEnrollments = await Enrollment.find({ allocationId: { $in: fixedAllocIds }, status: { $in: [...SEAT_HOLDING_ENROLLMENT_STATUSES, 'Waitlisted'] } })
    .select('allocationId status waitlistRank')
    .lean<EnrollmentLean[]>();
  const seatCount = new Map<string, number>();
  const maxWaitlistRank = new Map<string, number>();
  for (const e of fixedEnrollments) {
    const k = e.allocationId!.toString();
    if (e.status === 'Waitlisted') maxWaitlistRank.set(k, Math.max(maxWaitlistRank.get(k) ?? 0, e.waitlistRank ?? 0));
    else seatCount.set(k, (seatCount.get(k) ?? 0) + 1);
  }
  for (const f of fixed.values()) f.seatsTaken = seatCount.get(f.allocationId) ?? 0;

  // ---- Requests ----
  const requestDocs = await LearningRequest.find({ status: { $in: [...OPEN_REQUEST_STATUSES, 'Waitlisted'] } }).lean<RequestLean[]>();
  const active = await Enrollment.find({ requestId: { $in: requestDocs.map((r) => r._id) }, status: { $in: ACTIVE_ENROLLMENT_STATUSES } })
    .select('requestId offeringId')
    .lean<EnrollmentLean[]>();
  // A request that holds a place on an offering this run keeps (fixed, or skipped while
  // it is being reallocated) stays where it is; only re-optimisable places are re-decided.
  const pinned = new Set(active.filter((e) => !reoptimisable.has(e.offeringId.toString())).map((e) => e.requestId.toString()));
  const requests = requestDocs.filter((r) => !pinned.has(r._id.toString()));

  // ---- Geographic prefilter ----
  const spread = new Map<string, number>();
  for (const r of requests) {
    const c = areaCentre.get(r.areaId.toString());
    if (!c) continue;
    const d = Math.min(MAX_SPREAD_KM, haversineKm(c, toPoint(r.location)));
    spread.set(r.areaId.toString(), Math.max(spread.get(r.areaId.toString()) ?? 0, d));
  }
  const centres: { point: GeoPoint; radiusKm: number }[] = [];
  const centreAreas = new Set<string>([...requests.map((r) => r.areaId.toString())]);
  for (const o of included) if (o.targetAreaId && !fixed.has(o._id.toString())) centreAreas.add(o.targetAreaId.toString());
  for (const areaId of centreAreas) {
    const point = areaCentre.get(areaId);
    if (point) centres.push({ point, radiusKm: appSettings.maxRadiusKm + (spread.get(areaId) ?? 0) + PREFILTER_MARGIN_KM });
  }
  for (const p of opts.extraCentres ?? []) centres.push({ point: p, radiusKm: appSettings.maxRadiusKm + PREFILTER_MARGIN_KM });

  const mustInclude = new Set<string>([...(opts.includeSpaceIds ?? []), ...[...fixed.values()].map((f) => f.spaceId)]);
  const or: Record<string, unknown>[] = centres.map((c) => ({
    isActive: true,
    location: { $geoWithin: { $centerSphere: [[c.point.lng, c.point.lat], c.radiusKm / EARTH_RADIUS_KM] } },
  }));
  if (mustInclude.size > 0) or.push({ _id: { $in: [...mustInclude].map((id) => new Types.ObjectId(id)) } });
  const spaceDocs = or.length > 0 ? await Space.find({ $or: or }).lean<SpaceLean[]>() : [];

  const bookingDocs = await Allocation.find({
    spaceId: { $in: spaceDocs.map((s) => s._id) },
    status: { $in: BOOKING_ALLOCATION_STATUSES },
  })
    .select('spaceId session')
    .lean<AllocationLean[]>();
  const bookings = new Map<string, TimeWindow[]>();
  for (const b of bookingDocs) {
    if (excludeBookings.has(b._id.toString())) continue;
    const k = b.spaceId.toString();
    bookings.set(k, [...(bookings.get(k) ?? []), toTimeWindow(b.session)]);
  }

  const spaces: EngineSpace[] = spaceDocs.map((s) => ({
    id: s._id.toString(),
    name: s.name,
    ownerUserId: s.ownerUserId.toString(),
    areaId: s.areaId.toString(),
    location: toPoint(s.location),
    isActive: s.isActive,
    seatCapacity: s.seatCapacity,
    facilities: s.facilities.map((f) => ({ facilityTypeId: f.facilityTypeId.toString(), quantity: f.quantity, workingQuantity: f.workingQuantity })),
    slots: s.slots.map((sl) => ({ ...toTimeWindow(sl), slotId: sl._id.toString(), isBlocked: sl.isBlocked })),
    policy: {
      allowedCategoryIds: (s.policy?.allowedCategoryIds ?? []).map(String),
      allowedAudiences: s.policy?.allowedAudiences ?? [],
      rentPerHour: s.policy?.rentPerHour ?? 0,
      approvalMode: s.policy?.approvalMode ?? 'auto',
    },
    bookings: bookings.get(s._id.toString()) ?? [],
  }));

  // ---- Offerings for the engine ----
  const courses = await Course.find({ _id: { $in: included.map((o) => o.courseId) } }).select('requirements').lean();
  const reqsByCourse = new Map(courses.map((c) => [c._id.toString(), c.requirements ?? []]));
  const allocById = new Map(allocs.map((a) => [a._id.toString(), a]));
  const offerings: EngineOffering[] = included.map((o) => {
    const f = fixed.get(o._id.toString());
    const fixedAlloc = f ? allocById.get(f.allocationId) : undefined;
    return {
      id: o._id.toString(),
      courseId: o.courseId.toString(),
      providerUserId: o.providerUserId.toString(),
      title: o.title,
      categoryId: o.categoryId.toString(),
      audience: o.audience,
      batchSize: o.batchSize,
      sessionMinutes: o.sessionMinutes,
      durationWeeks: o.durationWeeks,
      targetAreaId: o.targetAreaId ? o.targetAreaId.toString() : null,
      windows: (o.windows ?? []).map(toTimeWindow),
      maxRentPerHour: o.maxRentPerHour ?? null,
      feePerMonth: o.feePerMonth ?? null,
      requirements: (reqsByCourse.get(o.courseId.toString()) ?? []).map((r) => ({ facilityTypeId: r.facilityTypeId.toString(), minQuantity: r.minQuantity })),
      ...(f && fixedAlloc
        ? { fixed: { allocationId: f.allocationId, spaceId: f.spaceId, session: toTimeWindow(fixedAlloc.session), seatsTaken: f.seatsTaken } }
        : {}),
    };
  });

  const engineRequests: EngineRequest[] = requests.map((r) => ({
    id: r._id.toString(),
    learnerUserId: r.learnerUserId.toString(),
    categoryId: r.categoryId.toString(),
    areaId: r.areaId.toString(),
    location: toPoint(r.location),
    audience: r.audience,
    maxDistanceKm: r.maxDistanceKm,
    windows: (r.windows ?? []).map(toTimeWindow),
    requiredFacilityTypeIds: (r.requiredFacilityTypeIds ?? []).map(String),
    budgetPerMonth: r.budgetPerMonth ?? null,
    createdAt: new Date(r.createdAt).toISOString(),
  }));

  const snapshot: EngineSnapshot = {
    now: now.toISOString(),
    areas: areas.map((a) => ({
      id: a._id.toString(),
      name: a.name,
      center: toPoint(a.center as { coordinates: number[] }),
      population: a.population,
      studentCount: a.studentCount,
      literacyRate: a.literacyRate,
      incomeScore: a.incomeScore,
      incomeGroup: a.incomeGroup as 'Low' | 'Medium' | 'High',
    })),
    categories: categories.map((c) => ({ id: c._id.toString(), name: c.name, parentId: c.parentId ? c.parentId.toString() : null })),
    facilityTypes: facilityTypes.map((f) => ({ id: f._id.toString(), name: f.name })),
    spaces,
    offerings,
    requests: engineRequests,
    demandBaseline: baseline.map((b) => ({ areaId: b.areaId.toString(), categoryId: b.categoryId.toString(), baseline: b.baseline })),
  };

  const ctx: SnapshotContext = {
    offerings: new Map(included.map((o) => [o._id.toString(), o])),
    spaces: new Map(spaceDocs.map((s) => [s._id.toString(), s])),
    fixed,
    reoptimisable,
    maxWaitlistRank,
    requestStatus: new Map(requests.map((r) => [r._id.toString(), r.status])),
    rejectedPairs: new Set(rejected.map((r) => `${r.offeringId.toString()}:${r.spaceId.toString()}`)),
  };
  return { snapshot, settings, appSettings, ctx };
}

/**
 * Reads the engine snapshot and settings from the database. Used by the worker and by
 * the recommendations API. `trigger` is informational (all triggers read the same data:
 * confirmed allocations are always passed as fixed, so no trigger can move them).
 */
export async function buildSnapshot(opts?: { trigger?: string }): Promise<{ snapshot: EngineSnapshot; settings: EngineSettings }> {
  const { snapshot, settings } = await buildSnapshotWithContext({ trigger: opts?.trigger });
  return { snapshot, settings };
}

