import { Types } from 'mongoose';
import type { z } from 'zod';
import { BOOKING_ALLOCATION_STATUSES, type OfferingStatus } from '@/lib/domain';
import { toMinutes } from '@/lib/utils';
import { Allocation, Course, CourseOffering, Partner } from '@/server/models';
import { assertOwner, conflict, isAdmin, notFound, pageMeta, type SessionUser } from '@/server/http';
import { audit, diffOf } from '@/server/services/audit';
import { emitEvent } from '@/server/services/events';
import { offeringDto, type OfferingDto, type OfferingRecord } from '@/server/dto/offering';
import { PROVIDER_OFFERING_STATUSES, type OfferingInput, type OfferingListQuery, type OfferingUpdate } from '@/schemas/offering';
import { requireArea, unprocessable } from './areas';
import { escapeRegex, namesById } from './lookups';

type Viewer = Pick<SessionUser, 'id' | 'role'>;
const SYSTEM_MANAGED: readonly OfferingStatus[] = ['Allocated', 'Active', 'Completed'];

async function enrich(rows: OfferingRecord[], viewer: Viewer): Promise<OfferingDto[]> {
  const [cats, areas] = await Promise.all([
    namesById('category', rows.map((r) => r.categoryId as Types.ObjectId)),
    namesById('area', rows.map((r) => r.targetAreaId as Types.ObjectId | null)),
  ]);
  const providerIds = [...new Set(rows.map((r) => String(r.providerUserId)))].map((i) => new Types.ObjectId(i));
  const partners = providerIds.length ? await Partner.find({ userId: { $in: providerIds } }).select('userId name').lean() : [];
  const pNames = new Map(partners.map((p) => [String(p.userId), p.name]));
  return rows.map((r) =>
    offeringDto(r, viewer, {
      categoryName: cats.get(String(r.categoryId)) ?? null,
      targetAreaName: r.targetAreaId ? (areas.get(String(r.targetAreaId)) ?? null) : null,
      providerName: pNames.get(String(r.providerUserId)) ?? null,
    }),
  );
}

const snapshot = (o: OfferingRecord) => ({
  ...offeringDto(o, { id: String(o.providerUserId), role: 'CourseProvider' }),
  canEdit: undefined,
  createdAt: undefined,
  updatedAt: undefined,
});

function assertProviderStatus(actor: SessionUser, from: OfferingStatus | null, to: OfferingStatus): void {
  if (isAdmin(actor)) return;
  if (!(PROVIDER_OFFERING_STATUSES as readonly string[]).includes(to)) {
    throw unprocessable('This status is set by Smart Allocation. Choose Draft, Open or Cancelled.', 'status');
  }
  if (from === 'Completed') throw conflict('A completed offering cannot change status.');
  if (from && SYSTEM_MANAGED.includes(from) && to !== 'Cancelled') {
    throw conflict('This offering already has a space. You can only cancel it.');
  }
}

function assertSessionFits(o: { sessionMinutes: number; windows?: { startTime: string; endTime: string }[] | null }): void {
  const windows = o.windows ?? [];
  if (windows.length === 0) return;
  if (!windows.some((w) => toMinutes(w.endTime) - toMinutes(w.startTime) >= o.sessionMinutes)) {
    throw unprocessable('The session must fit inside at least one window', 'sessionMinutes');
  }
}

/** GET /api/offerings. Drafts are visible to their provider and administrators only. */
export async function listOfferings(viewer: SessionUser, query: z.output<typeof OfferingListQuery>) {
  const me = new Types.ObjectId(viewer.id);
  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];
  if (query.mine === '1' || query.mine === 'true') filter.providerUserId = me;
  else if (!isAdmin(viewer)) and.push({ $or: [{ status: { $ne: 'Draft' } }, { providerUserId: me }] });
  if (query.status) filter.status = query.status;
  if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
  if (query.areaId) filter.targetAreaId = new Types.ObjectId(query.areaId);
  if (query.courseId) filter.courseId = new Types.ObjectId(query.courseId);
  if (query.q) filter.title = { $regex: escapeRegex(query.q), $options: 'i' };
  if (and.length) filter.$and = and;
  const [total, rows] = await Promise.all([
    CourseOffering.countDocuments(filter),
    CourseOffering.find(filter)
      .sort({ startDate: 1, _id: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<OfferingRecord[]>(),
  ]);
  return { items: await enrich(rows, viewer), ...pageMeta(total, query.page, query.pageSize) };
}

export async function getOffering(viewer: SessionUser, id: string): Promise<OfferingDto> {
  const o = await CourseOffering.findById(id).lean<OfferingRecord>();
  const own = o && (isAdmin(viewer) || String(o.providerUserId) === viewer.id);
  if (!o || (o.status === 'Draft' && !own)) throw notFound('Offering');
  return (await enrich([o], viewer))[0]!;
}

/** POST /api/offerings. The course decides the owner, title and category. */
export async function createOffering(actor: SessionUser, input: z.output<typeof OfferingInput>): Promise<OfferingDto> {
  const course = await Course.findById(input.courseId).select('providerUserId title categoryId').lean();
  if (!course) throw unprocessable('Choose a valid course', 'courseId');
  assertOwner(actor, course.providerUserId);
  const status: OfferingStatus = input.status ?? 'Open';
  assertProviderStatus(actor, null, status);
  if (input.targetAreaId) await requireArea(input.targetAreaId, 'targetAreaId');

  const doc = await CourseOffering.create({
    courseId: course._id,
    providerUserId: course.providerUserId,
    title: course.title,
    categoryId: course.categoryId,
    audience: input.audience ?? 'Adults',
    batchSize: input.batchSize,
    sessionMinutes: input.sessionMinutes,
    durationWeeks: input.durationWeeks,
    startDate: input.startDate,
    targetAreaId: input.targetAreaId ?? null,
    status,
    windows: input.windows ?? [],
    maxRentPerHour: input.maxRentPerHour ?? null,
    feePerMonth: input.feePerMonth ?? null,
  });
  const rec = doc.toObject() as unknown as OfferingRecord;
  await audit({ actor, action: 'create', entity: 'CourseOffering', entityId: doc._id, ownerUserId: course.providerUserId, diff: snapshot(rec) });
  await emitEvent('offering.saved', doc._id, { action: 'create' });
  return (await enrich([rec], actor))[0]!;
}

/** PATCH /api/offerings/[id] */
export async function updateOffering(actor: SessionUser, id: string, input: z.output<typeof OfferingUpdate>): Promise<OfferingDto> {
  const doc = await CourseOffering.findById(id);
  if (!doc) throw notFound('Offering');
  assertOwner(actor, doc.providerUserId);
  if (input.status !== undefined && input.status !== doc.status) {
    assertProviderStatus(actor, (doc.status ?? null) as OfferingStatus | null, input.status);
  }
  if (input.targetAreaId) await requireArea(input.targetAreaId, 'targetAreaId');
  const before = snapshot(doc.toObject() as unknown as OfferingRecord);
  for (const key of [
    'audience', 'batchSize', 'sessionMinutes', 'durationWeeks', 'startDate', 'targetAreaId', 'status', 'windows', 'maxRentPerHour', 'feePerMonth',
  ] as const) {
    if (input[key] !== undefined) doc.set(key, input[key]);
  }
  const rec0 = doc.toObject() as unknown as OfferingRecord;
  assertSessionFits(rec0);
  await doc.save();
  const rec = doc.toObject() as unknown as OfferingRecord;
  await audit({ actor, action: 'update', entity: 'CourseOffering', entityId: doc._id, ownerUserId: doc.providerUserId, diff: diffOf(before, snapshot(rec)) });
  await emitEvent('offering.saved', doc._id, { action: 'update' });
  return (await enrich([rec], actor))[0]!;
}

/** DELETE /api/offerings/[id]. Blocked while an allocation books a space for it. */
export async function deleteOffering(actor: SessionUser, id: string): Promise<void> {
  const doc = await CourseOffering.findById(id).lean<OfferingRecord>();
  if (!doc) throw notFound('Offering');
  assertOwner(actor, doc.providerUserId as Types.ObjectId);
  const booked = await Allocation.exists({ offeringId: doc._id, status: { $in: BOOKING_ALLOCATION_STATUSES } });
  if (booked) throw conflict('This offering has a booked space. Cancel the offering instead of deleting it.');
  await CourseOffering.deleteOne({ _id: doc._id });
  await audit({ actor, action: 'delete', entity: 'CourseOffering', entityId: doc._id, ownerUserId: doc.providerUserId, diff: snapshot(doc) });
  await emitEvent('offering.deleted', doc._id as Types.ObjectId, { providerUserId: String(doc.providerUserId) });
}
