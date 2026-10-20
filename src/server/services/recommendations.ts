import { Types } from 'mongoose';
import {
  Allocation, Area, CourseCategory, CourseOffering, DemandInsight, Enrollment, LearningRequest, Partner, Space, User,
} from '@/server/models';
import { BOOKING_ALLOCATION_STATUSES, OPEN_REQUEST_STATUSES, SEAT_HOLDING_ENROLLMENT_STATUSES, type AllocationStatus } from '@/lib/domain';
import { formatInr, formatKm, formatWindow } from '@/lib/format';
import { logger } from '@/lib/logger';
import { forbidden, notFound } from '@/server/http';
import { buildSnapshot } from '@/server/worker/snapshot';
import { getEngine } from '@/server/services/engine-client';
import type { Suggestion } from '@/engine/types';
import type { SessionUser } from '@/server/auth/session';
import { getSettings } from './settings';
import { haversineKm, learnerAreaId, pointOf, round1 } from './insights';

/** Allocations whose space a learner could attend (anything still alive). */
const LIVE_ALLOCATION_STATUSES: readonly AllocationStatus[] = ['Proposed', ...BOOKING_ALLOCATION_STATUSES];

export interface RecommendationItem {
  offeringId: string | null;
  offeringTitle: string | null;
  providerName: string | null;
  categoryId: string;
  categoryName: string;
  spaceId: string | null;
  spaceName: string | null;
  areaId: string | null;
  areaName: string | null;
  session: string | null;
  feePerMonth: number | null;
  /** From the learner's AREA CENTRE (never the exact point) to the space, or to the suggested area. */
  distanceKm: number | null;
  /** Compatibility score, 0..1. */
  score: number;
  reasons: string[];
}

export interface RecommendationResult {
  requestId: string;
  requestStatus: string;
  source: 'stored' | 'live' | 'none';
  items: RecommendationItem[];
}

interface Located {
  spaceId: string | null;
  spaceName: string | null;
  areaId: string | null;
  point: [number, number] | null;
  session: string | null;
}

/** Display names for providers: their partner organisation, else their user name. */
export async function providerNames(userIds: Types.ObjectId[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.map(String))].map((id) => new Types.ObjectId(id));
  const [partners, users] = await Promise.all([
    Partner.find({ userId: { $in: ids } }).select('userId name').lean(),
    User.find({ _id: { $in: ids } }).select('name').lean(),
  ]);
  const out = new Map(users.map((u) => [u._id.toString(), u.name]));
  for (const p of partners) out.set(p.userId.toString(), p.name);
  return out;
}

/** Where each offering would run: its live allocation's space, else its target area. */
export async function locateOfferings(
  offerings: { _id: Types.ObjectId; targetAreaId?: Types.ObjectId | null }[],
): Promise<Map<string, Located>> {
  const allocations = await Allocation.find({ offeringId: { $in: offerings.map((o) => o._id) }, status: { $in: LIVE_ALLOCATION_STATUSES } })
    .sort({ createdAt: -1 })
    .select('offeringId spaceId session')
    .lean();
  const spaces = await Space.find({ _id: { $in: allocations.map((a) => a.spaceId) } }).select('name location areaId').lean();
  const targetAreas = await Area.find({ _id: { $in: offerings.map((o) => o.targetAreaId).filter(Boolean) } }).select('center').lean();
  const spaceById = new Map(spaces.map((s) => [s._id.toString(), s]));
  const areaById = new Map(targetAreas.map((a) => [a._id.toString(), a]));
  const out = new Map<string, Located>();
  for (const o of offerings) {
    const alloc = allocations.find((a) => a.offeringId.toString() === o._id.toString());
    const sp = alloc ? spaceById.get(alloc.spaceId.toString()) : undefined;
    if (alloc && sp) {
      out.set(o._id.toString(), {
        spaceId: sp._id.toString(), spaceName: sp.name, areaId: sp.areaId.toString(), point: pointOf(sp.location), session: formatWindow(alloc.session),
      });
    } else {
      const ta = o.targetAreaId ? areaById.get(o.targetAreaId.toString()) : undefined;
      out.set(o._id.toString(), {
        spaceId: null, spaceName: null, areaId: o.targetAreaId?.toString() ?? null, point: ta ? pointOf(ta.center) : null, session: null,
      });
    }
  }
  return out;
}

/**
 * Suggestions for one request (F-17, README 13.8): the ones stored by the last run when
 * present, otherwise computed live by the engine. The request's status is never changed,
 * so an unmatched request stays open for future offerings.
 */
export async function recommendationsFor(user: SessionUser, requestId: Types.ObjectId): Promise<RecommendationResult> {
  const request = await LearningRequest.findById(requestId).select('learnerUserId areaId status suggestions').lean();
  if (!request) throw notFound('Request');
  if (user.role !== 'Administrator' && request.learnerUserId.toString() !== user.id) throw forbidden('You can only see recommendations for your own requests.');

  let source: RecommendationResult['source'] = 'none';
  let suggestions: Suggestion[] = [];
  if (request.suggestions.length > 0) {
    source = 'stored';
    suggestions = request.suggestions.map((s) => ({
      offeringId: s.offeringId?.toString() ?? null,
      categoryId: s.categoryId.toString(),
      areaId: s.areaId?.toString() ?? null,
      score: s.score,
      reasons: s.reasons,
    }));
  } else {
    try {
      const { snapshot, settings } = await buildSnapshot();
      suggestions = getEngine().suggestFor(snapshot, settings, requestId.toString()).slice(0, 3);
      source = 'live';
    } catch (err) {
      logger.warn('recommendations.live_failed', { requestId: requestId.toString(), message: (err as Error).message });
    }
  }

  const items = await resolveSuggestions(suggestions, request.areaId);
  return { requestId: requestId.toString(), requestStatus: request.status, source, items };
}

async function resolveSuggestions(suggestions: Suggestion[], learnerAreaIdValue: Types.ObjectId): Promise<RecommendationItem[]> {
  if (suggestions.length === 0) return [];
  const offeringIds = suggestions.map((s) => s.offeringId).filter((v): v is string => Boolean(v)).map((id) => new Types.ObjectId(id));
  const offerings = await CourseOffering.find({ _id: { $in: offeringIds } }).select('title providerUserId categoryId feePerMonth targetAreaId').lean();
  const located = await locateOfferings(offerings);
  const names = await providerNames(offerings.map((o) => o.providerUserId));
  const areaIds = new Set<string>([learnerAreaIdValue.toString()]);
  for (const s of suggestions) if (s.areaId) areaIds.add(s.areaId);
  for (const l of located.values()) if (l.areaId) areaIds.add(l.areaId);
  const [areas, categories] = await Promise.all([
    Area.find({ _id: { $in: [...areaIds].map((id) => new Types.ObjectId(id)) } }).select('name center').lean(),
    CourseCategory.find({ _id: { $in: suggestions.map((s) => new Types.ObjectId(s.categoryId)) } }).select('name').lean(),
  ]);
  const areaById = new Map(areas.map((a) => [a._id.toString(), a]));
  const catName = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const home = areaById.get(learnerAreaIdValue.toString());
  const homeCentre = home ? pointOf(home.center) : null;

  return suggestions.map((s) => {
    const off = s.offeringId ? offerings.find((o) => o._id.toString() === s.offeringId) : undefined;
    const loc = off ? located.get(off._id.toString()) : undefined;
    const areaId = loc?.areaId ?? s.areaId;
    const area = areaId ? areaById.get(areaId) : undefined;
    const point = loc?.point ?? (area ? pointOf(area.center) : null);
    return {
      offeringId: off?._id.toString() ?? null,
      offeringTitle: off?.title ?? null,
      providerName: off ? names.get(off.providerUserId.toString()) ?? null : null,
      categoryId: s.categoryId,
      categoryName: catName.get(s.categoryId) ?? 'Course',
      spaceId: loc?.spaceId ?? null,
      spaceName: loc?.spaceName ?? null,
      areaId: areaId ?? null,
      areaName: area?.name ?? null,
      session: loc?.session ?? null,
      feePerMonth: off?.feePerMonth ?? null,
      distanceKm: homeCentre && point ? round1(haversineKm(homeCentre, point)) : null,
      score: s.score,
      reasons: s.reasons,
    };
  });
}

// ---- Discover Courses ----

export interface DiscoverOffering {
  offeringId: string;
  title: string;
  providerName: string;
  categoryId: string;
  categoryName: string;
  status: string;
  spaceName: string | null;
  areaName: string | null;
  session: string | null;
  seatsLeft: number;
  feePerMonth: number | null;
  distanceKm: number | null;
  matchesRequest: boolean;
  reasons: string[];
}

export interface DiscoverCategory {
  categoryId: string;
  categoryName: string;
  reasons: string[];
}

export interface DiscoverResult {
  areaId: string | null;
  areaName: string | null;
  radiusKm: number;
  offerings: DiscoverOffering[];
  highDemandCategories: DiscoverCategory[];
  similarCategories: DiscoverCategory[];
}

/** Discover Courses for a learner: nearby offerings with seats, high-demand and similar categories. */
export async function discoverFor(user: SessionUser): Promise<DiscoverResult> {
  const settings = await getSettings();
  const areaId = await learnerAreaId(user.id);
  const home = areaId ? await Area.findById(areaId).select('name center').lean() : null;
  const centre = home ? pointOf(home.center) : null;
  const requests = await LearningRequest.find({ learnerUserId: new Types.ObjectId(user.id), status: { $in: OPEN_REQUEST_STATUSES } })
    .select('categoryId maxDistanceKm')
    .lean();
  const radiusKm = Math.max(settings.maxRadiusKm, ...requests.map((r) => r.maxDistanceKm));
  const wanted = new Set(requests.map((r) => r.categoryId.toString()));

  // Offerings with seats left.
  const offerings = await CourseOffering.find({ status: { $in: ['Open', 'Allocated'] } })
    .select('title providerUserId categoryId status batchSize feePerMonth targetAreaId')
    .lean();
  const held = await Enrollment.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { offeringId: { $in: offerings.map((o) => o._id) }, status: { $in: SEAT_HOLDING_ENROLLMENT_STATUSES } } },
    { $group: { _id: '$offeringId', n: { $sum: 1 } } },
  ]);
  const heldBy = new Map(held.map((h) => [h._id.toString(), h.n]));
  const withSeats = offerings.filter((o) => o.batchSize - (heldBy.get(o._id.toString()) ?? 0) > 0);
  const located = await locateOfferings(withSeats);
  const names = await providerNames(withSeats.map((o) => o.providerUserId));
  const cats = await CourseCategory.find().select('name parentId').lean();
  const catById = new Map(cats.map((c) => [c._id.toString(), c]));
  const areaIds = [...new Set([...located.values()].map((l) => l.areaId).filter((v): v is string => Boolean(v)))];
  const areaNames = new Map(
    (await Area.find({ _id: { $in: areaIds.map((id) => new Types.ObjectId(id)) } }).select('name').lean()).map((a) => [a._id.toString(), a.name]),
  );

  const found: DiscoverOffering[] = [];
  for (const o of withSeats) {
    const loc = located.get(o._id.toString())!;
    const distanceKm = centre && loc.point ? round1(haversineKm(centre, loc.point)) : null;
    if (distanceKm !== null && distanceKm > radiusKm) continue;
    const seatsLeft = o.batchSize - (heldBy.get(o._id.toString()) ?? 0);
    const categoryName = catById.get(o.categoryId.toString())?.name ?? 'Course';
    const matchesRequest = wanted.has(o.categoryId.toString());
    const reasons: string[] = [];
    if (matchesRequest) reasons.push(`Matches your ${categoryName} request`);
    if (distanceKm !== null) reasons.push(`${formatKm(distanceKm)} from your area centre`);
    reasons.push(`${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left`);
    reasons.push(o.feePerMonth ? `${formatInr(o.feePerMonth)} per month` : 'Free');
    if (loc.session) reasons.push(loc.session);
    found.push({
      offeringId: o._id.toString(),
      title: o.title,
      providerName: names.get(o.providerUserId.toString()) ?? 'Course provider',
      categoryId: o.categoryId.toString(),
      categoryName,
      status: o.status,
      spaceName: loc.spaceName,
      areaName: loc.areaId ? areaNames.get(loc.areaId) ?? null : null,
      session: loc.session,
      seatsLeft,
      feePerMonth: o.feePerMonth ?? null,
      distanceKm,
      matchesRequest,
      reasons,
    });
  }
  found.sort(
    (a, b) =>
      Number(b.matchesRequest) - Number(a.matchesRequest) ||
      (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
      a.title.localeCompare(b.title),
  );

  // High-demand categories in areas near the learner (aggregated insights only).
  const highDemandCategories: DiscoverCategory[] = [];
  if (centre) {
    const allAreas = await Area.find().select('name center').lean();
    const near = allAreas.filter((a) => haversineKm(centre, pointOf(a.center)) <= radiusKm);
    const nearName = new Map(near.map((a) => [a._id.toString(), a.name]));
    const rows = await DemandInsight.find({ areaId: { $in: near.map((a) => a._id) }, level: { $in: ['High', 'Medium'] } }).lean();
    const byCat = new Map<string, { demand: number; areas: string[]; high: boolean }>();
    for (const r of rows) {
      const k = r.categoryId.toString();
      const e = byCat.get(k) ?? { demand: 0, areas: [], high: false };
      e.demand += r.demand;
      e.areas.push(nearName.get(r.areaId.toString()) ?? 'a nearby area');
      e.high ||= r.level === 'High';
      byCat.set(k, e);
    }
    for (const [k, e] of [...byCat.entries()].sort((a, b) => b[1].demand - a[1].demand).slice(0, 5)) {
      const reasons = [`${e.high ? 'High' : 'Growing'} demand in ${e.areas.slice(0, 2).join(' and ')}${e.areas.length > 2 ? ` and ${e.areas.length - 2} more nearby` : ''}`];
      if (wanted.has(k)) reasons.push('You already asked for this');
      highDemandCategories.push({ categoryId: k, categoryName: catById.get(k)?.name ?? 'Course', reasons });
    }
  }

  // Similar categories: same parent as (or parent of) a category the learner asked for.
  const similar = new Map<string, DiscoverCategory>();
  for (const wantedId of wanted) {
    const c = catById.get(wantedId);
    if (!c) continue;
    const parentId = c.parentId?.toString() ?? null;
    for (const other of cats) {
      const id = other._id.toString();
      if (id === wantedId || wanted.has(id) || similar.has(id)) continue;
      const sibling = parentId !== null && other.parentId?.toString() === parentId;
      const isParent = parentId !== null && id === parentId;
      const isChild = other.parentId?.toString() === wantedId;
      if (!sibling && !isParent && !isChild) continue;
      const group = parentId ? catById.get(parentId)?.name : c.name;
      similar.set(id, { categoryId: id, categoryName: other.name, reasons: [`Similar to ${c.name}${group ? ` (${group})` : ''}`] });
    }
  }

  return {
    areaId: areaId?.toString() ?? null,
    areaName: home?.name ?? null,
    radiusKm,
    offerings: found.slice(0, 30),
    highDemandCategories,
    similarCategories: [...similar.values()].slice(0, 6),
  };
}
