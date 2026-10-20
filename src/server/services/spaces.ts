import { Types } from 'mongoose';
import type { z } from 'zod';
import { BOOKING_ALLOCATION_STATUSES } from '@/lib/domain';
import { Allocation, Partner, Space, User } from '@/server/models';
import { assertOwner, conflict, isAdmin, notFound, pageMeta, type SessionUser } from '@/server/http';
import { audit, diffOf } from '@/server/services/audit';
import { emitEvent } from '@/server/services/events';
import { canEditSpace, spaceDto, type SpaceDto, type SpaceRecord } from '@/server/dto/space';
import type { SpaceInput, SpaceListQuery, SpaceUpdate } from '@/schemas/space';
import { requireArea, snapToArea, unprocessable } from './areas';
import { escapeRegex, namesById, requireCategories, requireFacilityTypes } from './lookups';

type Viewer = Pick<SessionUser, 'id' | 'role'>;
type SpaceCreate = z.output<typeof SpaceInput>;
type SpacePatch = z.output<typeof SpaceUpdate>;

async function withAreaNames(rows: SpaceRecord[], viewer: Viewer): Promise<SpaceDto[]> {
  const names = await namesById('area', rows.map((r) => r.areaId as Types.ObjectId));
  return rows.map((r) => spaceDto(r, viewer, { areaName: names.get(String(r.areaId)) ?? null }));
}

async function one(doc: SpaceRecord, viewer: Viewer): Promise<SpaceDto> {
  const [dto] = await withAreaNames([doc], viewer);
  return dto!;
}

function slotDocs(slots: NonNullable<SpacePatch['slots']>) {
  return slots.map((s) => ({
    ...(s.id ? { _id: new Types.ObjectId(s.id) } : {}),
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    isBlocked: s.isBlocked ?? false,
  }));
}

async function validateRefs(input: SpacePatch): Promise<void> {
  if (input.facilities) await requireFacilityTypes(input.facilities.map((f) => f.facilityTypeId), 'facilities');
  if (input.policy?.allowedCategoryIds) await requireCategories(input.policy.allowedCategoryIds, 'policy.allowedCategoryIds');
}

/** Audit-friendly snapshot of a space (owner view). */
const snapshot = (s: SpaceRecord) => ({ ...spaceDto(s, { id: String(s.ownerUserId), role: 'SpaceGiver' }), updatedAt: undefined, createdAt: undefined });

/** GET /api/spaces */
export async function listSpaces(viewer: SessionUser, query: z.output<typeof SpaceListQuery>) {
  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];
  if (query.mine === '1' || query.mine === 'true') filter.ownerUserId = new Types.ObjectId(viewer.id);
  else if (!isAdmin(viewer)) and.push({ $or: [{ isActive: true }, { ownerUserId: new Types.ObjectId(viewer.id) }] });
  if (query.areaId) filter.areaId = new Types.ObjectId(query.areaId);
  if (query.q) {
    const rx = { $regex: escapeRegex(query.q), $options: 'i' };
    and.push({ $or: [{ name: rx }, { address: rx }, { description: rx }] });
  }
  if (and.length) filter.$and = and;
  const [total, rows] = await Promise.all([
    Space.countDocuments(filter),
    Space.find(filter)
      .sort({ name: 1, _id: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<SpaceRecord[]>(),
  ]);
  return { items: await withAreaNames(rows, viewer), ...pageMeta(total, query.page, query.pageSize) };
}

/** GET /api/spaces/[id]. Inactive spaces are visible to the owner and administrators only. */
export async function getSpace(viewer: SessionUser, id: string): Promise<SpaceDto> {
  const s = await Space.findById(id).lean<SpaceRecord>();
  if (!s || (s.isActive === false && !canEditSpace(viewer, s))) throw notFound('Space');
  return one(s, viewer);
}

/** POST /api/spaces (Space Giver for themself; Administrator for anyone). */
export async function createSpace(actor: SessionUser, input: SpaceCreate): Promise<SpaceDto> {
  let ownerUserId = new Types.ObjectId(actor.id);
  if (input.ownerUserId && input.ownerUserId !== actor.id) {
    if (!isAdmin(actor)) throw unprocessable('Only administrators can create a space for someone else', 'ownerUserId');
    const owner = await User.findById(input.ownerUserId).select('role').lean();
    if (!owner || owner.role !== 'SpaceGiver') throw unprocessable('The owner must be a Space Giver', 'ownerUserId');
    ownerUserId = owner._id;
  }
  const partner = await Partner.findOne({ userId: ownerUserId }).select('_id').lean();
  const area = input.areaId ? await requireArea(input.areaId) : await snapToArea(input.location.coordinates);
  await validateRefs(input);

  const doc = new Space({
    ownerUserId,
    partnerId: partner?._id ?? null,
    name: input.name,
    description: input.description ?? '',
    address: input.address ?? '',
    location: { type: 'Point', coordinates: input.location.coordinates },
    areaId: area._id,
    isActive: input.isActive ?? true,
    seatCapacity: input.seatCapacity,
    photos: input.photos ?? [],
    facilities: input.facilities ?? [],
    slots: slotDocs(input.slots ?? []),
    policy: input.policy ?? {},
  });
  await doc.save();
  const rec = doc.toObject() as unknown as SpaceRecord;
  await audit({ actor, action: 'create', entity: 'Space', entityId: doc._id, ownerUserId, diff: snapshot(rec) });
  await emitEvent('space.saved', doc._id, { action: 'create' });
  return one(rec, actor);
}

/** PATCH /api/spaces/[id]. Arrays replace; policy fields merge. */
export async function updateSpace(actor: SessionUser, id: string, input: SpacePatch): Promise<SpaceDto> {
  const doc = await Space.findById(id);
  if (!doc) throw notFound('Space');
  assertOwner(actor, doc.ownerUserId);
  const before = snapshot(doc.toObject() as unknown as SpaceRecord);
  await validateRefs(input);

  for (const key of ['name', 'description', 'address', 'isActive', 'seatCapacity', 'photos', 'facilities'] as const) {
    if (input[key] !== undefined) doc.set(key, input[key]);
  }
  if (input.slots !== undefined) doc.set('slots', slotDocs(input.slots));
  if (input.policy !== undefined) {
    const current = (doc.toObject() as unknown as SpaceRecord).policy ?? {};
    const merged = { ...current, ...Object.fromEntries(Object.entries(input.policy).filter(([, v]) => v !== undefined)) };
    doc.set('policy', merged);
  }
  if (input.location !== undefined) doc.set('location', { type: 'Point', coordinates: input.location.coordinates });
  if (input.areaId !== undefined) {
    doc.set('areaId', (await requireArea(input.areaId))._id);
  } else if (input.location !== undefined) {
    doc.set('areaId', (await snapToArea(input.location.coordinates))._id);
  }
  await doc.save();

  const rec = doc.toObject() as unknown as SpaceRecord;
  await audit({ actor, action: 'update', entity: 'Space', entityId: doc._id, ownerUserId: doc.ownerUserId, diff: diffOf(before, snapshot(rec)) });
  await emitEvent('space.saved', doc._id, { action: 'update' });
  return one(rec, actor);
}

/** DELETE /api/spaces/[id]. Blocked while any allocation books the space. */
export async function deleteSpace(actor: SessionUser, id: string): Promise<void> {
  const doc = await Space.findById(id).lean<SpaceRecord>();
  if (!doc) throw notFound('Space');
  assertOwner(actor, doc.ownerUserId as Types.ObjectId);
  const booked = await Allocation.exists({ spaceId: doc._id, status: { $in: BOOKING_ALLOCATION_STATUSES } });
  if (booked) throw conflict('This space has booked classes. Cancel or move them before deleting the space.');
  await Space.deleteOne({ _id: doc._id });
  await audit({ actor, action: 'delete', entity: 'Space', entityId: doc._id, ownerUserId: doc.ownerUserId, diff: snapshot(doc) });
  await emitEvent('space.deleted', doc._id as Types.ObjectId, { ownerUserId: String(doc.ownerUserId) });
}
