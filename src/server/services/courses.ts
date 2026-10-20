import { Types } from 'mongoose';
import type { z } from 'zod';
import { Course, CourseOffering, Partner, User } from '@/server/models';
import { assertOwner, conflict, isAdmin, notFound, pageMeta, type SessionUser } from '@/server/http';
import { audit, diffOf } from '@/server/services/audit';
import { emitEvent } from '@/server/services/events';
import { courseDto, type CourseDto, type CourseRecord } from '@/server/dto/course';
import type { CourseInput, CourseListQuery, CourseUpdate } from '@/schemas/course';
import { unprocessable } from './areas';
import { escapeRegex, namesById, requireCategory, requireFacilityTypes } from './lookups';

type Viewer = Pick<SessionUser, 'id' | 'role'>;

async function enrich(rows: CourseRecord[], viewer: Viewer): Promise<CourseDto[]> {
  const cats = await namesById('category', rows.map((r) => r.categoryId as Types.ObjectId));
  const partnerIds = [...new Set(rows.map((r) => r.partnerId).filter(Boolean).map(String))];
  const partners = partnerIds.length
    ? await Partner.find({ _id: { $in: partnerIds.map((i) => new Types.ObjectId(i)) } }).select('name').lean()
    : [];
  const pNames = new Map(partners.map((p) => [String(p._id), p.name]));
  return rows.map((r) =>
    courseDto(r, viewer, {
      categoryName: cats.get(String(r.categoryId)) ?? null,
      providerName: r.partnerId ? (pNames.get(String(r.partnerId)) ?? null) : null,
    }),
  );
}

const snapshot = (c: CourseRecord) => ({ ...courseDto(c, { id: '', role: 'Learner' }), canEdit: undefined, createdAt: undefined, updatedAt: undefined });

/** GET /api/courses: the catalogue is readable by every signed-in role. */
export async function listCourses(viewer: SessionUser, query: z.output<typeof CourseListQuery>) {
  const filter: Record<string, unknown> = {};
  if (query.mine === '1' || query.mine === 'true') filter.providerUserId = new Types.ObjectId(viewer.id);
  if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
  if (query.q) {
    const rx = { $regex: escapeRegex(query.q), $options: 'i' };
    filter.$or = [{ title: rx }, { description: rx }];
  }
  const [total, rows] = await Promise.all([
    Course.countDocuments(filter),
    Course.find(filter)
      .sort({ title: 1, _id: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<CourseRecord[]>(),
  ]);
  return { items: await enrich(rows, viewer), ...pageMeta(total, query.page, query.pageSize) };
}

export async function getCourse(viewer: SessionUser, id: string): Promise<CourseDto> {
  const c = await Course.findById(id).lean<CourseRecord>();
  if (!c) throw notFound('Course');
  return (await enrich([c], viewer))[0]!;
}

/** POST /api/courses (Course Provider for themself; Administrator for anyone). */
export async function createCourse(actor: SessionUser, input: z.output<typeof CourseInput>): Promise<CourseDto> {
  let providerUserId = new Types.ObjectId(actor.id);
  if (input.providerUserId && input.providerUserId !== actor.id) {
    if (!isAdmin(actor)) throw unprocessable('Only administrators can create a course for someone else', 'providerUserId');
    const owner = await User.findById(input.providerUserId).select('role').lean();
    if (!owner || owner.role !== 'CourseProvider') throw unprocessable('The provider must be a Course Provider', 'providerUserId');
    providerUserId = owner._id;
  }
  await requireCategory(input.categoryId);
  if (input.requirements) await requireFacilityTypes(input.requirements.map((r) => r.facilityTypeId), 'requirements');
  const partner = await Partner.findOne({ userId: providerUserId }).select('_id').lean();
  const doc = await Course.create({
    providerUserId,
    partnerId: partner?._id ?? null,
    title: input.title,
    description: input.description ?? '',
    categoryId: input.categoryId,
    requirements: input.requirements ?? [],
    coverUrl: input.coverUrl ?? '',
  });
  const rec = doc.toObject() as unknown as CourseRecord;
  await audit({ actor, action: 'create', entity: 'Course', entityId: doc._id, ownerUserId: providerUserId, diff: snapshot(rec) });
  return (await enrich([rec], actor))[0]!;
}

/**
 * PATCH /api/courses/[id]. A new title or category is copied to the course's offerings
 * (they carry denormalised copies), and each changed offering emits offering.saved.
 */
export async function updateCourse(actor: SessionUser, id: string, input: z.output<typeof CourseUpdate>): Promise<CourseDto> {
  const doc = await Course.findById(id);
  if (!doc) throw notFound('Course');
  assertOwner(actor, doc.providerUserId);
  if (input.categoryId) await requireCategory(input.categoryId);
  if (input.requirements) await requireFacilityTypes(input.requirements.map((r) => r.facilityTypeId), 'requirements');
  const before = snapshot(doc.toObject() as unknown as CourseRecord);
  for (const key of ['title', 'description', 'categoryId', 'requirements', 'coverUrl'] as const) {
    if (input[key] !== undefined) doc.set(key, input[key]);
  }
  await doc.save();
  const rec = doc.toObject() as unknown as CourseRecord;
  const after = snapshot(rec);

  const cascade: Record<string, unknown> = {};
  if (after.title !== before.title) cascade.title = after.title;
  if (after.categoryId !== before.categoryId) cascade.categoryId = doc.categoryId;
  if (Object.keys(cascade).length) {
    const offerings = await CourseOffering.find({ courseId: doc._id }).select('_id').lean();
    if (offerings.length) {
      await CourseOffering.updateMany({ courseId: doc._id }, { $set: cascade });
      for (const o of offerings) await emitEvent('offering.saved', o._id, { action: 'course.update' });
    }
  }
  await audit({ actor, action: 'update', entity: 'Course', entityId: doc._id, ownerUserId: doc.providerUserId, diff: diffOf(before, after) });
  return (await enrich([rec], actor))[0]!;
}

/** DELETE /api/courses/[id]. Blocked while the course has offerings. */
export async function deleteCourse(actor: SessionUser, id: string): Promise<void> {
  const doc = await Course.findById(id).lean<CourseRecord>();
  if (!doc) throw notFound('Course');
  assertOwner(actor, doc.providerUserId as Types.ObjectId);
  if (await CourseOffering.exists({ courseId: doc._id })) {
    throw conflict('This course has offerings. Delete or cancel them before deleting the course.');
  }
  await Course.deleteOne({ _id: doc._id });
  await audit({ actor, action: 'delete', entity: 'Course', entityId: doc._id, ownerUserId: doc.providerUserId, diff: snapshot(doc) });
}
