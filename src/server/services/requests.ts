// Learning requests. Exact learner locations leave this module only inside
// RequestFullDto, which is built for the learner themself and administrators.
// Matched Course Providers and Space Givers get MatchedRequestDto, redacted by stage
// through learnerViewFor (src/server/dto/privacy.ts).

import { Types } from 'mongoose';
import type { z } from 'zod';
import { audienceForAgeBand, type AgeBand, type RequestStatus } from '@/lib/domain';
import { Allocation, Area, CourseOffering, Enrollment, LearnerProfile, LearningRequest } from '@/server/models';
import { assertOwner, conflict, forbidden, isAdmin, notFound, pageMeta, type SessionUser } from '@/server/http';
import { audit, diffOf } from '@/server/services/audit';
import { emitEvent } from '@/server/services/events';
import { notify } from '@/server/notifications/notify';
import { releaseEnrollmentsForRequest } from '@/server/services/enrollments';
import { learnerViewFor, stageFromEnrollment, type DisclosureStage } from '@/server/dto/privacy';
import {
  learnerSourceOf,
  requestFullDto,
  type MatchedRequestDto,
  type RequestDto,
  type RequestFullDto,
  type RequestRecord,
  type TimelineEntry,
} from '@/server/dto/request';
import { lngLat, type AreaRecord } from '@/server/dto/lookup';
import { EDITABLE_REQUEST_STATUSES, type RequestInput, type RequestListQuery, type RequestUpdate } from '@/schemas/request';
import { snapToArea } from './areas';
import { escapeRegex, namesById, requireCategory, requireFacilityTypes } from './lookups';

type ListQuery = z.output<typeof RequestListQuery>;
type Paged<T> = { items: T[]; total: number; page: number; pageSize: number; pages: number };

const TERMINAL_STATUSES: readonly RequestStatus[] = ['Completed', 'Declined', 'Expired', 'Cancelled'];
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

interface ProfileLean {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  ageBand: string;
  contactPhone?: string;
  contactEmail?: string;
  accessibilityNeeds?: string[];
}

/** Audit snapshot without the exact location (audit entries are readable as "own activity"). */
function auditSnapshot(r: RequestRecord): Record<string, unknown> {
  const { location: _location, areaCenter: _centre, suggestions: _s, statusTimeline: _t, createdAt: _c, updatedAt: _u, ...rest } =
    requestFullDto(r);
  return rest;
}

async function loadAreas(ids: (string | Types.ObjectId)[]): Promise<Map<string, AreaRecord>> {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map();
  const rows = await Area.find({ _id: { $in: unique.map(oid) } }).select('name center').lean<AreaRecord[]>();
  return new Map(rows.map((a) => [String(a._id), a]));
}

async function loadProfiles(ids: (string | Types.ObjectId)[]): Promise<Map<string, ProfileLean>> {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map();
  const rows = await LearnerProfile.find({ _id: { $in: unique.map(oid) } }).lean<ProfileLean[]>();
  return new Map(rows.map((p) => [String(p._id), p]));
}

async function fullDtos(rows: RequestRecord[]): Promise<RequestFullDto[]> {
  const [areas, cats, profiles] = await Promise.all([
    loadAreas(rows.map((r) => r.areaId as Types.ObjectId)),
    namesById('category', rows.map((r) => r.categoryId as Types.ObjectId)),
    loadProfiles(rows.map((r) => r.learnerProfileId as Types.ObjectId)),
  ]);
  return rows.map((r) => {
    const area = areas.get(String(r.areaId));
    return requestFullDto(r, {
      learnerName: profiles.get(String(r.learnerProfileId))?.name ?? null,
      categoryName: cats.get(String(r.categoryId)) ?? null,
      areaName: area?.name ?? null,
      areaCenter: area ? lngLat(area.center) : null,
    });
  });
}

async function statusTimeline(r: RequestRecord): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [
    { status: 'Submitted', at: new Date(r.createdAt ?? r.consentAt).toISOString(), source: 'request', note: '', offeringId: null },
  ];
  const enrollments = await Enrollment.find({ requestId: r._id }).select('offeringId status statusHistory createdAt').lean();
  for (const e of enrollments) {
    const history = e.statusHistory ?? [];
    if (history.length === 0) {
      entries.push({ status: e.status, at: new Date(e.createdAt).toISOString(), source: 'enrollment', note: '', offeringId: String(e.offeringId) });
    }
    for (const h of history) {
      entries.push({ status: h.status, at: new Date(h.at).toISOString(), source: 'enrollment', note: h.note ?? '', offeringId: String(e.offeringId) });
    }
  }
  const current = r.status ?? 'Submitted';
  if (current !== 'Submitted' && !entries.some((x) => x.status === current)) {
    entries.push({ status: current, at: new Date(r.updatedAt ?? Date.now()).toISOString(), source: 'request', note: '', offeringId: null });
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

// ---- Matched parties ----

const STAGE_RANK: Record<DisclosureStage, number> = { beforeMatching: 0, proposed: 1, accepted: 2 };

/**
 * Requests matched to a Course Provider (an enrollment on one of their offerings) or a
 * Space Giver (an enrollment on an allocation at one of their spaces), each redacted by
 * the most advanced enrollment stage. Requests with no disclosable stage are dropped.
 */
export async function matchedFor(viewer: SessionUser, opts: { requestId?: string } = {}): Promise<MatchedRequestDto[]> {
  const me = oid(viewer.id);
  let relation: 'provider' | 'spaceGiver';
  const filter: Record<string, unknown> = {};
  if (viewer.role === 'CourseProvider') {
    relation = 'provider';
    filter.offeringId = { $in: await CourseOffering.find({ providerUserId: me }).distinct('_id') };
  } else if (viewer.role === 'SpaceGiver') {
    relation = 'spaceGiver';
    filter.allocationId = { $in: await Allocation.find({ spaceOwnerUserId: me }).distinct('_id') };
  } else {
    return [];
  }
  if (opts.requestId) filter.requestId = oid(opts.requestId);
  const enrollments = await Enrollment.find(filter).select('requestId offeringId status updatedAt').sort({ updatedAt: -1 }).lean();

  const best = new Map<string, (typeof enrollments)[number]>();
  for (const e of enrollments) {
    if (STAGE_RANK[stageFromEnrollment(e.status)] === 0) continue;
    const key = String(e.requestId);
    const prev = best.get(key);
    if (!prev || STAGE_RANK[stageFromEnrollment(e.status)] > STAGE_RANK[stageFromEnrollment(prev.status)]) best.set(key, e);
  }
  if (best.size === 0) return [];

  const requests = await LearningRequest.find({ _id: { $in: [...best.keys()].map(oid) } }).lean<RequestRecord[]>();
  const [areas, cats, profiles, offerings] = await Promise.all([
    loadAreas(requests.map((r) => r.areaId as Types.ObjectId)),
    namesById('category', requests.map((r) => r.categoryId as Types.ObjectId)),
    loadProfiles(requests.map((r) => r.learnerProfileId as Types.ObjectId)),
    CourseOffering.find({ _id: { $in: [...best.values()].map((e) => e.offeringId) } }).select('title').lean(),
  ]);
  const titles = new Map(offerings.map((o) => [String(o._id), o.title]));
  const byId = new Map(requests.map((r) => [String(r._id), r]));

  const out: MatchedRequestDto[] = [];
  for (const [requestId, e] of best) {
    const r = byId.get(requestId);
    if (!r) continue;
    const stage = stageFromEnrollment(e.status);
    const src = learnerSourceOf(
      r,
      profiles.get(String(r.learnerProfileId)) ?? null,
      areas.get(String(r.areaId)) ?? null,
      cats.get(String(r.categoryId)) ?? null,
    );
    const view = learnerViewFor({ id: viewer.id, role: viewer.role }, src, stage, relation);
    if (!view || view.visibility === 'full') continue;
    out.push({
      visibility: 'matched',
      requestId,
      relation,
      stage,
      enrollmentId: String(e._id),
      enrollmentStatus: e.status,
      offeringId: String(e.offeringId),
      offeringTitle: titles.get(String(e.offeringId)) ?? null,
      learner: view,
    });
  }
  return out;
}

function page<T>(all: T[], query: { page: number; pageSize: number }): Paged<T> {
  const start = (query.page - 1) * query.pageSize;
  return { items: all.slice(start, start + query.pageSize), ...pageMeta(all.length, query.page, query.pageSize) };
}

// ---- Reads ----

async function listFull(base: Record<string, unknown>, query: ListQuery): Promise<Paged<RequestFullDto>> {
  const filter: Record<string, unknown> = { ...base };
  if (query.status) filter.status = query.status;
  if (query.categoryId) filter.categoryId = oid(query.categoryId);
  if (query.areaId) filter.areaId = oid(query.areaId);
  if (query.q) {
    const rx = { $regex: escapeRegex(query.q), $options: 'i' };
    const profileIds = await LearnerProfile.find({ name: rx }).distinct('_id');
    filter.$or = [{ learnerProfileId: { $in: profileIds } }, { notes: rx }];
  }
  const [total, rows] = await Promise.all([
    LearningRequest.countDocuments(filter),
    LearningRequest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<RequestRecord[]>(),
  ]);
  return { items: await fullDtos(rows), ...pageMeta(total, query.page, query.pageSize) };
}

/**
 * GET /api/requests. Administrators: all requests (full). Learners: their own (full).
 * Course Providers and Space Givers: matched requests only, redacted by stage.
 */
export async function listRequests(viewer: SessionUser, query: ListQuery): Promise<Paged<RequestDto>> {
  if (isAdmin(viewer)) return listFull({}, query);
  if (viewer.role === 'Learner') return listFull({ learnerUserId: oid(viewer.id) }, query);
  return listMatched(viewer, query);
}

/** GET /api/requests/mine (Learner). */
export function listMine(viewer: SessionUser, query: ListQuery): Promise<Paged<RequestFullDto>> {
  return listFull({ learnerUserId: oid(viewer.id) }, query);
}

/** GET /api/requests/matched (Course Provider, Space Giver). */
export async function listMatched(viewer: SessionUser, query: ListQuery): Promise<Paged<MatchedRequestDto>> {
  let all = await matchedFor(viewer);
  if (query.status) all = all.filter((m) => m.enrollmentStatus === query.status || ('status' in m.learner && m.learner.status === query.status));
  if (query.q) {
    const q = query.q.toLowerCase();
    all = all.filter((m) => (m.offeringTitle ?? '').toLowerCase().includes(q) || ('name' in m.learner && m.learner.name.toLowerCase().includes(q)));
  }
  return page(all, query);
}

/** GET /api/requests/[id]: full for the learner and administrators, redacted for matched parties, 404 for others. */
export async function getRequest(viewer: SessionUser, id: string): Promise<RequestDto> {
  const r = await LearningRequest.findById(id).lean<RequestRecord>();
  if (!r) throw notFound('Request');
  if (isAdmin(viewer) || String(r.learnerUserId) === viewer.id) {
    const [dto] = await fullDtos([r]);
    return { ...dto!, statusTimeline: await statusTimeline(r) };
  }
  const [matched] = await matchedFor(viewer, { requestId: id });
  if (!matched) throw notFound('Request');
  return matched;
}

// ---- Writes ----

/** POST /api/requests (Learner). */
export async function createRequest(actor: SessionUser, input: z.output<typeof RequestInput>): Promise<RequestFullDto> {
  const profile = await LearnerProfile.findOne({ userId: oid(actor.id) }).lean<ProfileLean>();
  if (!profile) throw forbidden('Only learners with a profile can submit requests.');
  const category = await requireCategory(input.categoryId);
  if (input.requiredFacilityTypeIds) await requireFacilityTypes(input.requiredFacilityTypeIds, 'requiredFacilityTypeIds');
  const area = await snapToArea(input.location.coordinates);

  const doc = await LearningRequest.create({
    learnerUserId: oid(actor.id),
    learnerProfileId: profile._id,
    categoryId: category._id,
    areaId: area._id,
    location: { type: 'Point', coordinates: input.location.coordinates },
    audience: audienceForAgeBand(profile.ageBand as AgeBand),
    maxDistanceKm: input.maxDistanceKm,
    startMonth: input.startMonth,
    durationMonths: input.durationMonths,
    consentShared: true,
    consentAt: new Date(),
    status: 'Submitted',
    windows: input.windows ?? [],
    requiredFacilityTypeIds: input.requiredFacilityTypeIds ?? [],
    budgetPerMonth: input.budgetPerMonth ?? null,
    notes: input.notes ?? '',
  });
  const rec = doc.toObject() as unknown as RequestRecord;
  await audit({ actor, action: 'create', entity: 'LearningRequest', entityId: doc._id, ownerUserId: actor.id, diff: auditSnapshot(rec) });
  await emitEvent('request.saved', doc._id, { action: 'create' });
  await notify({
    type: 'request.received',
    userIds: [actor.id],
    vars: { categoryName: category.name },
    related: { type: 'LearningRequest', id: doc._id },
    href: `/requests/${String(doc._id)}`,
  });
  return (await fullDtos([rec]))[0]!;
}

/** PATCH /api/requests/[id]: the learner (or an administrator) while Submitted, Analysed or Unmatched. */
export async function updateRequest(actor: SessionUser, id: string, input: z.output<typeof RequestUpdate>): Promise<RequestFullDto> {
  const doc = await LearningRequest.findById(id);
  if (!doc) throw notFound('Request');
  assertOwner(actor, doc.learnerUserId);
  if (!(EDITABLE_REQUEST_STATUSES as readonly string[]).includes(doc.status ?? 'Submitted')) {
    throw conflict(`This request is ${doc.status} and can no longer be edited.`);
  }
  if (input.categoryId) await requireCategory(input.categoryId);
  if (input.requiredFacilityTypeIds) await requireFacilityTypes(input.requiredFacilityTypeIds, 'requiredFacilityTypeIds');
  const before = auditSnapshot(doc.toObject() as unknown as RequestRecord);

  for (const key of ['categoryId', 'maxDistanceKm', 'startMonth', 'durationMonths', 'windows', 'requiredFacilityTypeIds', 'budgetPerMonth', 'notes'] as const) {
    if (input[key] !== undefined) doc.set(key, input[key]);
  }
  if (input.consentShared) doc.consentAt = new Date();
  let locationChanged = false;
  if (input.location) {
    const [lng, lat] = input.location.coordinates;
    const [oldLng, oldLat] = lngLat(doc.location);
    if (lng !== oldLng || lat !== oldLat) {
      locationChanged = true;
      const area = await snapToArea(input.location.coordinates);
      doc.set('location', { type: 'Point', coordinates: [lng, lat] });
      doc.set('areaId', area._id);
    }
  }
  await doc.save();
  const rec = doc.toObject() as unknown as RequestRecord;
  await audit({
    actor,
    action: 'update',
    entity: 'LearningRequest',
    entityId: doc._id,
    ownerUserId: doc.learnerUserId,
    diff: { ...diffOf(before, auditSnapshot(rec)), ...(locationChanged ? { location: 'changed' } : {}) },
  });
  await emitEvent('request.saved', doc._id, { action: 'update' });
  return (await fullDtos([rec]))[0]!;
}

/** POST /api/requests/[id]/cancel: the learner or an administrator. Releases held seats. */
export async function cancelRequest(actor: SessionUser, id: string): Promise<RequestFullDto> {
  const doc = await LearningRequest.findById(id);
  if (!doc) throw notFound('Request');
  assertOwner(actor, doc.learnerUserId);
  const from = (doc.status ?? 'Submitted') as RequestStatus;
  if (TERMINAL_STATUSES.includes(from)) throw conflict(`This request is already ${from}.`);
  doc.status = 'Cancelled';
  await doc.save();
  await releaseEnrollmentsForRequest(String(doc._id), actor);
  await emitEvent('request.cancelled', doc._id, { from });
  await audit({ actor, action: 'cancel', entity: 'LearningRequest', entityId: doc._id, ownerUserId: doc.learnerUserId, diff: { status: { from, to: 'Cancelled' } } });
  return (await fullDtos([doc.toObject() as unknown as RequestRecord]))[0]!;
}

