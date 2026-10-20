import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { AlertState, Allocation, Area, Course, CourseCategory, CourseOffering, LearningRequest, Space } from '@/server/models';
import { BOOKING_ALLOCATION_STATUSES, OPEN_REQUEST_STATUSES, type AllocationStatus } from '@/lib/domain';
import { formatWindow } from '@/lib/format';
import { toMinutes } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { notify } from '@/server/notifications/notify';
import { getSettings } from './settings';
import { haversineKm, pointOf } from './insights';

/** Allocations that count as a confirmed class covering demand ("from ConfirmedByProvider onwards", still running). */
export const COVERING_ALLOCATION_STATUSES: readonly AllocationStatus[] = ['ConfirmedByProvider', 'Scheduled', 'Active'];

interface AreaCount {
  areaId: string;
  count: number;
}

/** Stable signature of an alert: the areas involved and their demand, bucketed so tiny changes do not re-fire. */
export function alertSignature(areas: AreaCount[], bucketSize: number): string {
  const size = Math.max(1, bucketSize);
  const parts = [...areas]
    .sort((a, b) => a.areaId.localeCompare(b.areaId))
    .map((a) => `${a.areaId}:${Math.floor(a.count / size)}`);
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) =>
  toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);

/**
 * Multi-area demand alert (README 14): for each course category, the areas with at least
 * `alertMinRequests` open requests created in the last `alertWindowDays` days. When at least
 * `alertMinAreas` such areas have no confirmed class for that category, Space Givers with a
 * free slot nearby and Course Providers teaching the category (or its parent) are told once.
 * The alert repeats only after the set of areas or their bucketed demand changes.
 */
export async function evaluateDemandAlerts(): Promise<{ fired: number }> {
  const s = await getSettings();
  const since = new Date(Date.now() - s.alertWindowDays * 86_400_000);
  const counts = await LearningRequest.aggregate<{ _id: { categoryId: Types.ObjectId; areaId: Types.ObjectId }; n: number }>([
    { $match: { status: { $in: OPEN_REQUEST_STATUSES }, createdAt: { $gte: since } } },
    { $group: { _id: { categoryId: '$categoryId', areaId: '$areaId' }, n: { $sum: 1 } } },
    { $match: { n: { $gte: s.alertMinRequests } } },
  ]);

  const byCategory = new Map<string, AreaCount[]>();
  for (const c of counts) {
    const k = c._id.categoryId.toString();
    const list = byCategory.get(k) ?? [];
    list.push({ areaId: c._id.areaId.toString(), count: c.n });
    byCategory.set(k, list);
  }

  // Categories that no longer qualify forget their alert, so a later surge alerts again.
  const qualifying = [...byCategory.entries()].filter(([, areas]) => areas.length >= s.alertMinAreas).map(([k]) => k);
  await AlertState.deleteMany({ key: { $regex: /^demand:/, $nin: qualifying.map((k) => `demand:${k}`) } });

  let fired = 0;
  for (const categoryId of qualifying) {
    const candidate = byCategory.get(categoryId)!;
    const uncovered = await withoutCoveredAreas(categoryId, candidate);
    const key = `demand:${categoryId}`;
    if (uncovered.length < s.alertMinAreas) {
      await AlertState.deleteOne({ key });
      continue;
    }
    const signature = alertSignature(uncovered, s.alertMinRequests);
    if (!(await claimAlert(key, signature))) continue;
    try {
      await sendDemandAlert(categoryId, uncovered, s.maxRadiusKm);
      fired += 1;
    } catch (err) {
      // Release the claim so the next evaluation retries.
      await AlertState.deleteOne({ key, signature });
      logger.error('alerts.demand_failed', { categoryId, message: (err as Error).message });
    }
  }
  return { fired };
}

/** Atomically records the new signature. False when this exact alert was already sent. */
async function claimAlert(key: string, signature: string): Promise<boolean> {
  try {
    await AlertState.findOneAndUpdate(
      { key, signature: { $ne: signature } },
      { $set: { signature, lastFiredAt: new Date() } },
      { upsert: true },
    );
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

/** Drops areas where a confirmed (or later) class of this category already runs. */
async function withoutCoveredAreas(categoryId: string, areas: AreaCount[]): Promise<AreaCount[]> {
  const offerings = await CourseOffering.find({ categoryId: new Types.ObjectId(categoryId) }).select('_id targetAreaId').lean();
  if (offerings.length === 0) return areas;
  const allocations = await Allocation.find({
    offeringId: { $in: offerings.map((o) => o._id) },
    status: { $in: COVERING_ALLOCATION_STATUSES },
  })
    .select('spaceId offeringId')
    .lean();
  if (allocations.length === 0) return areas;
  const spaces = await Space.find({ _id: { $in: allocations.map((a) => a.spaceId) } }).select('areaId').lean();
  const covered = new Set(spaces.map((sp) => sp.areaId.toString()));
  const target = new Map(offerings.map((o) => [o._id.toString(), o.targetAreaId?.toString() ?? null]));
  for (const a of allocations) {
    const t = target.get(a.offeringId.toString());
    if (t) covered.add(t);
  }
  return areas.filter((a) => !covered.has(a.areaId));
}

async function sendDemandAlert(categoryId: string, areas: AreaCount[], maxRadiusKm: number): Promise<void> {
  const catId = new Types.ObjectId(categoryId);
  const [category, areaDocs] = await Promise.all([
    CourseCategory.findById(catId).select('name parentId').lean(),
    Area.find({ _id: { $in: areas.map((a) => new Types.ObjectId(a.areaId)) } }).select('name center').lean(),
  ]);
  const nameOf = (id: string) => areaDocs.find((a) => a._id.toString() === id)?.name ?? '';
  // Anchor: the area with the most requests (ties broken by name, so the message is stable).
  const anchor = [...areas].sort((a, b) => b.count - a.count || nameOf(a.areaId).localeCompare(nameOf(b.areaId)))[0]!;
  const anchorArea = areaDocs.find((a) => a._id.toString() === anchor.areaId);
  const requestCount = areas.reduce((n, a) => n + a.count, 0);
  const base = {
    categoryName: category?.name ?? 'this course',
    areaCount: areas.length,
    anchorArea: anchorArea?.name ?? 'your area',
    requestCount,
  };
  const href = `/demand-insights?categoryId=${categoryId}`;
  const related = { type: 'CourseCategory', id: catId };

  // Space Givers: an active space near any of the areas, open to the category, with a free slot.
  const centres = areaDocs.map((a) => pointOf(a.center));
  const spaces = await Space.find({
    isActive: true,
    $or: [{ 'policy.allowedCategoryIds': { $size: 0 } }, { 'policy.allowedCategoryIds': catId }],
  })
    .select('ownerUserId name location seatCapacity slots')
    .lean();
  const nearby = spaces
    .map((sp) => ({ sp, km: Math.min(...centres.map((c) => haversineKm(pointOf(sp.location), c))) }))
    .filter((x) => x.km <= maxRadiusKm)
    .sort((a, b) => a.km - b.km);
  const bookings = await Allocation.find({ spaceId: { $in: nearby.map((x) => x.sp._id) }, status: { $in: BOOKING_ALLOCATION_STATUSES } })
    .select('spaceId session')
    .lean();
  const notified = new Set<string>();
  for (const { sp } of nearby) {
    const owner = sp.ownerUserId.toString();
    if (notified.has(owner)) continue;
    const booked = bookings.filter((b) => b.spaceId.toString() === sp._id.toString()).map((b) => b.session);
    const free = sp.slots
      .filter((sl) => !sl.isBlocked && !booked.some((b) => b.dayOfWeek === sl.dayOfWeek && overlaps(b, sl)))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime))[0];
    if (!free) continue;
    notified.add(owner);
    await notify({
      type: 'demand.alert',
      userIds: [sp.ownerUserId],
      vars: { ...base, freeSlot: `${formatWindow(free)} (${sp.seatCapacity} seats)`, spaceName: sp.name, seats: sp.seatCapacity },
      related,
      href,
    });
  }

  // Course Providers with a course in this category or its parent.
  const catIds = [catId, ...(category?.parentId ? [category.parentId] : [])];
  const providers = (await Course.distinct('providerUserId', { categoryId: { $in: catIds } })) as Types.ObjectId[];
  if (providers.length > 0) {
    await notify({ type: 'demand.alert', userIds: providers, vars: base, related, href });
  }
}
