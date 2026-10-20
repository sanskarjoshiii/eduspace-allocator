import { Types } from 'mongoose';
import { Allocation, Area, CourseCategory, CourseOffering, Enrollment, LearningRequest, Space } from '@/server/models';
import {
  BOOKING_ALLOCATION_STATUSES, OPEN_REQUEST_STATUSES, SEAT_HOLDING_ENROLLMENT_STATUSES, type AllocationStatus, type Role,
} from '@/lib/domain';
import { formatWindow } from '@/lib/format';
import { toMinutes } from '@/lib/utils';
import type { MapQuery } from '@/schemas/map';
import type { SessionUser } from '@/server/auth/session';
import type {
  LngLat, MapAllocationLine, MapDemandArea, MapOffer, MapPayload, MapSpace, MapUnusedSpace,
} from '@/server/dto/map';
import { areaTotals, haversineKm, learnerAreaId, pointOf, round1 } from './insights';

type Window = { dayOfWeek: number; startTime: string; endTime: string };
type Slot = Window & { isBlocked?: boolean | null };

/** Allocations drawn as lines (anything not finished or rejected). */
const LINE_ALLOCATION_STATUSES: readonly AllocationStatus[] = ['Proposed', ...BOOKING_ALLOCATION_STATUSES];
/** Allocations a learner may see as nearby offers. */
const OFFER_ALLOCATION_STATUSES: readonly AllocationStatus[] = ['ConfirmedByProvider', 'Scheduled', 'Active'];

export const MAP_LAYERS_BY_ROLE: Record<Role, readonly string[]> = {
  Administrator: ['spaces', 'allocations', 'demand', 'unused'],
  SpaceGiver: ['spaces', 'allocations', 'demand', 'unused'],
  CourseProvider: ['spaces', 'allocations', 'demand'],
  Learner: ['spaces', 'demand', 'offers'],
};

/** Weekly open, booked and free hours of a space, and its free (unblocked, unbooked) slots. */
export function slotUsage(slots: Slot[], bookings: Window[]): { openHours: number; bookedHours: number; freeHours: number; freeSlots: Window[] } {
  let openMin = 0;
  let bookedMin = 0;
  const freeSlots: Window[] = [];
  for (const sl of slots) {
    if (sl.isBlocked) continue;
    const s0 = toMinutes(sl.startTime);
    const s1 = toMinutes(sl.endTime);
    openMin += Math.max(0, s1 - s0);
    // Merge overlapping bookings on this slot so nothing is counted twice.
    const parts = bookings
      .filter((b) => b.dayOfWeek === sl.dayOfWeek)
      .map((b) => [Math.max(s0, toMinutes(b.startTime)), Math.min(s1, toMinutes(b.endTime))] as const)
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let used = 0;
    let cursor = s0;
    for (const [a, b] of parts) {
      const from = Math.max(a, cursor);
      if (b > from) used += b - from;
      cursor = Math.max(cursor, b);
    }
    bookedMin += used;
    if (used === 0) freeSlots.push({ dayOfWeek: sl.dayOfWeek, startTime: sl.startTime, endTime: sl.endTime });
  }
  const r = (m: number) => round1(m / 60);
  return { openHours: r(openMin), bookedHours: r(bookedMin), freeHours: r(openMin - bookedMin), freeSlots };
}

/**
 * Role-scoped map layers (README 15, PLAN 6.5/6.6). Learner positions appear only as
 * area centres; exact request points never leave this function.
 */
export async function getMap(user: SessionUser, query: MapQuery): Promise<MapPayload> {
  const allowed = new Set(MAP_LAYERS_BY_ROLE[user.role]);
  const want = (l: string) => query.layers.includes(l as never) && allowed.has(l);
  const isAdmin = user.role === 'Administrator';
  const me = new Types.ObjectId(user.id);

  const layers: MapPayload['layers'] = {};
  let home: MapPayload['home'] = null;
  if (user.role === 'Learner') {
    const areaId = await learnerAreaId(user.id);
    const area = areaId ? await Area.findById(areaId).select('name center').lean() : null;
    if (area) home = { areaId: area._id.toString(), areaName: area.name, center: pointOf(area.center) };
  }

  if (want('spaces') || want('unused')) {
    const spaceFilter: Record<string, unknown> = {};
    if (!isAdmin && user.role !== 'SpaceGiver') spaceFilter.isActive = true;
    if (user.role === 'SpaceGiver') spaceFilter.$or = [{ ownerUserId: me }, { isActive: true }];
    if (query.categoryId) {
      const cat = new Types.ObjectId(query.categoryId);
      spaceFilter.$and = [{ $or: [{ 'policy.allowedCategoryIds': { $size: 0 } }, { 'policy.allowedCategoryIds': cat }] }];
    }
    const spaces = await Space.find(spaceFilter).select('ownerUserId name location areaId isActive seatCapacity slots').lean();
    const bookings = await Allocation.find({ spaceId: { $in: spaces.map((s) => s._id) }, status: { $in: BOOKING_ALLOCATION_STATUSES } })
      .select('spaceId session')
      .lean();
    const areaNames = new Map(
      (await Area.find({ _id: { $in: spaces.map((s) => s.areaId) } }).select('name').lean()).map((a) => [a._id.toString(), a.name]),
    );
    const usageOf = (id: string, slots: Slot[]) => slotUsage(slots, bookings.filter((b) => b.spaceId.toString() === id).map((b) => b.session));

    if (want('spaces')) {
      const out: MapSpace[] = [];
      for (const s of spaces) {
        const id = s._id.toString();
        const owned = isAdmin || s.ownerUserId.toString() === user.id;
        const usage = usageOf(id, s.slots);
        const status = !s.isActive ? 'inactive' : usage.freeSlots.length > 0 ? 'available' : 'booked';
        if (query.availableOnly && status !== 'available') continue;
        out.push({
          id,
          name: s.name,
          coordinates: pointOf(s.location),
          status,
          seatCapacity: s.seatCapacity,
          areaId: s.areaId.toString(),
          areaName: areaNames.get(s.areaId.toString()) ?? '',
          owned,
          openHours: owned ? usage.openHours : null,
          bookedHours: owned ? usage.bookedHours : null,
        });
      }
      layers.spaces = out;
    }
    if (want('unused')) {
      const own = spaces.filter((s) => s.isActive && (isAdmin || s.ownerUserId.toString() === user.id));
      layers.unused = own
        .map((s): MapUnusedSpace => {
          const u = usageOf(s._id.toString(), s.slots);
          return {
            spaceId: s._id.toString(),
            spaceName: s.name,
            coordinates: pointOf(s.location),
            openHours: u.openHours,
            bookedHours: u.bookedHours,
            freeHours: u.freeHours,
            freeSlots: u.freeSlots.map((w) => formatWindow(w)),
          };
        })
        .sort((a, b) => b.freeHours - a.freeHours);
    }
  }

  if (want('allocations')) layers.allocations = await allocationLines(user, query.categoryId);

  if (want('demand')) {
    const totals = await areaTotals({ categoryId: query.categoryId, level: query.level });
    layers.demand = totals.map((t): MapDemandArea => ({
      areaId: t.areaId,
      areaName: t.areaName,
      center: t.areaCenter,
      demandLevel: t.demandLevel,
      openRequests: t.openRequests,
      demand: t.demand,
      seatsOffered: t.seatsOffered,
      gap: t.gap,
    }));
  }

  if (want('offers')) layers.offers = await nearbyOffers(user, query.categoryId);

  const pts: LngLat[] = layers.spaces?.map((s) => s.coordinates) ?? [];
  const center: LngLat | null = home?.center ??
    (pts.length ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] : null);
  return { layers, center, home };
}

async function allocationLines(user: SessionUser, categoryId?: string): Promise<MapAllocationLine[]> {
  const q: Record<string, unknown> = { status: { $in: LINE_ALLOCATION_STATUSES } };
  if (user.role === 'SpaceGiver') q.spaceOwnerUserId = new Types.ObjectId(user.id);
  if (user.role === 'CourseProvider') q.providerUserId = new Types.ObjectId(user.id);
  if (user.role === 'Learner') return [];
  const allocations = await Allocation.find(q).select('offeringId spaceId status').lean();
  const [offerings, spaces, enrollments] = await Promise.all([
    CourseOffering.find({ _id: { $in: allocations.map((a) => a.offeringId) } }).select('title categoryId').lean(),
    Space.find({ _id: { $in: allocations.map((a) => a.spaceId) } }).select('name location').lean(),
    Enrollment.find({ allocationId: { $in: allocations.map((a) => a._id) }, status: { $in: SEAT_HOLDING_ENROLLMENT_STATUSES } })
      .select('allocationId requestId')
      .lean(),
  ]);
  // Only the request's AREA is read; its exact location is never selected.
  const requests = await LearningRequest.find({ _id: { $in: enrollments.map((e) => e.requestId) } }).select('areaId').lean();
  const areas = await Area.find({ _id: { $in: requests.map((r) => r.areaId) } }).select('name center').lean();
  const reqArea = new Map(requests.map((r) => [r._id.toString(), r.areaId.toString()]));
  const areaById = new Map(areas.map((a) => [a._id.toString(), a]));

  const out: MapAllocationLine[] = [];
  for (const a of allocations) {
    const off = offerings.find((o) => o._id.toString() === a.offeringId.toString());
    const sp = spaces.find((s) => s._id.toString() === a.spaceId.toString());
    if (!off || !sp) continue;
    if (categoryId && off.categoryId.toString() !== categoryId) continue;
    const counts = new Map<string, number>();
    for (const e of enrollments) {
      if (e.allocationId?.toString() !== a._id.toString()) continue;
      const areaId = reqArea.get(e.requestId.toString());
      if (areaId) counts.set(areaId, (counts.get(areaId) ?? 0) + 1);
    }
    out.push({
      allocationId: a._id.toString(),
      offeringTitle: off.title,
      categoryId: off.categoryId.toString(),
      status: a.status,
      spaceId: sp._id.toString(),
      spaceName: sp.name,
      from: pointOf(sp.location),
      to: [...counts.entries()].map(([areaId, learners]) => {
        const area = areaById.get(areaId);
        return { areaId, areaName: area?.name ?? '', center: pointOf(area?.center), learners };
      }),
    });
  }
  return out;
}

/** Confirmed or scheduled classes with seats within each open request's distance of the request's AREA CENTRE. */
async function nearbyOffers(user: SessionUser, categoryId?: string): Promise<MapOffer[]> {
  if (user.role !== 'Learner') return [];
  const requests = await LearningRequest.find({ learnerUserId: new Types.ObjectId(user.id), status: { $in: OPEN_REQUEST_STATUSES } })
    .select('areaId categoryId maxDistanceKm')
    .lean();
  if (requests.length === 0) return [];
  const reqAreas = await Area.find({ _id: { $in: requests.map((r) => r.areaId) } }).select('center').lean();
  const centreOf = new Map(reqAreas.map((a) => [a._id.toString(), pointOf(a.center)]));

  const allocations = await Allocation.find({ status: { $in: OFFER_ALLOCATION_STATUSES } }).select('offeringId spaceId session').lean();
  const offeringFilter: Record<string, unknown> = { _id: { $in: allocations.map((a) => a.offeringId) } };
  if (categoryId) offeringFilter.categoryId = new Types.ObjectId(categoryId);
  const [offerings, spaces, held] = await Promise.all([
    CourseOffering.find(offeringFilter).select('title categoryId batchSize feePerMonth').lean(),
    Space.find({ _id: { $in: allocations.map((a) => a.spaceId) }, isActive: true }).select('name location').lean(),
    Enrollment.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { allocationId: { $in: allocations.map((a) => a._id) }, status: { $in: SEAT_HOLDING_ENROLLMENT_STATUSES } } },
      { $group: { _id: '$allocationId', n: { $sum: 1 } } },
    ]),
  ]);
  const cats = new Map(
    (await CourseCategory.find({ _id: { $in: offerings.map((o) => o.categoryId) } }).select('name').lean()).map((c) => [c._id.toString(), c.name]),
  );
  const heldBy = new Map(held.map((h) => [h._id.toString(), h.n]));

  const best = new Map<string, { rank: number; offer: MapOffer }>();
  for (const a of allocations) {
    const off = offerings.find((o) => o._id.toString() === a.offeringId.toString());
    const sp = spaces.find((s) => s._id.toString() === a.spaceId.toString());
    if (!off || !sp) continue;
    const seatsLeft = off.batchSize - (heldBy.get(a._id.toString()) ?? 0);
    if (seatsLeft <= 0) continue;
    const point = pointOf(sp.location);
    for (const r of requests) {
      const centre = centreOf.get(r.areaId.toString());
      if (!centre) continue;
      const km = haversineKm(centre, point);
      if (km > r.maxDistanceKm) continue;
      // Prefer the request in the same category, then the closer one.
      const rank = (r.categoryId.toString() === off.categoryId.toString() ? 0 : 1000) + km;
      const prev = best.get(a._id.toString());
      if (prev && prev.rank <= rank) continue;
      best.set(a._id.toString(), { rank, offer: {
        allocationId: a._id.toString(),
        offeringId: off._id.toString(),
        title: off.title,
        categoryId: off.categoryId.toString(),
        categoryName: cats.get(off.categoryId.toString()) ?? '',
        spaceName: sp.name,
        coordinates: point,
        session: formatWindow(a.session),
        seatsLeft,
        distanceKm: round1(km),
        requestId: r._id.toString(),
        feePerMonth: off.feePerMonth ?? null,
      } });
    }
  }
  return [...best.values()].map((b) => b.offer).sort((a, b) => a.distanceKm - b.distanceKm);
}
