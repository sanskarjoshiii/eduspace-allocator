import { Types } from 'mongoose';
import { CourseOffering, Enrollment, Feedback, User } from '@/server/models';
import { conflict, forbidden, notFound } from '@/server/http';
import type { FeedbackInput } from '@/schemas/feedback';
import type { SessionUser } from '@/server/auth/session';
import { audit } from './audit';

export interface FeedbackDto {
  id: string;
  enrollmentId: string;
  offeringId: string;
  offeringTitle: string;
  rating: number;
  comment: string;
  /** Shown to administrators and to the learner themself; providers see feedback anonymously. */
  learnerName: string | null;
  createdAt: string;
}

export interface FeedbackList {
  items: FeedbackDto[];
  count: number;
  /** Mean rating to two decimals; null when there is no feedback. */
  averageRating: number | null;
}

/** A learner rates a course they hold an accepted seat in. One rating per enrollment. */
export async function submitFeedback(user: SessionUser, input: FeedbackInput): Promise<FeedbackDto> {
  const enrollment = await Enrollment.findById(input.enrollmentId).select('learnerUserId offeringId status').lean();
  if (!enrollment) throw notFound('Enrollment');
  if (enrollment.learnerUserId.toString() !== user.id || enrollment.status !== 'Accepted') {
    throw forbidden('Only learners enrolled in this course can rate it.');
  }
  if (await Feedback.exists({ enrollmentId: enrollment._id })) throw conflict('You have already rated this course.');
  const doc = await Feedback.create({
    enrollmentId: enrollment._id,
    learnerUserId: enrollment.learnerUserId,
    offeringId: enrollment.offeringId,
    rating: input.rating,
    comment: input.comment,
  });
  await audit({ actor: user, action: 'create', entity: 'Feedback', entityId: doc._id, diff: { offeringId: enrollment.offeringId.toString(), rating: input.rating } });
  const offering = await CourseOffering.findById(enrollment.offeringId).select('title').lean();
  return {
    id: doc._id.toString(),
    enrollmentId: enrollment._id.toString(),
    offeringId: enrollment.offeringId.toString(),
    offeringTitle: offering?.title ?? 'Course',
    rating: doc.rating,
    comment: doc.comment,
    learnerName: user.name,
    createdAt: doc.createdAt.toISOString(),
  };
}

/**
 * Feedback list with the average rating. Providers: their own offerings (all of them when
 * no offeringId). Learners: only their own feedback. Administrators: everything.
 */
export async function listFeedback(user: SessionUser, offeringId?: string): Promise<FeedbackList> {
  const q: Record<string, unknown> = {};
  if (offeringId) {
    const offering = await CourseOffering.findById(offeringId).select('providerUserId').lean();
    if (!offering) throw notFound('Offering');
    if (user.role === 'CourseProvider' && offering.providerUserId.toString() !== user.id) throw forbidden();
    q.offeringId = offering._id;
  } else if (user.role === 'CourseProvider') {
    const own = await CourseOffering.find({ providerUserId: new Types.ObjectId(user.id) }).select('_id').lean();
    q.offeringId = { $in: own.map((o) => o._id) };
  }
  if (user.role === 'Learner') q.learnerUserId = new Types.ObjectId(user.id);
  if (user.role === 'SpaceGiver') throw forbidden();

  const rows = await Feedback.find(q).sort({ createdAt: -1 }).limit(500).lean();
  const [offerings, learners] = await Promise.all([
    CourseOffering.find({ _id: { $in: rows.map((r) => r.offeringId) } }).select('title').lean(),
    user.role === 'CourseProvider' ? Promise.resolve([]) : User.find({ _id: { $in: rows.map((r) => r.learnerUserId) } }).select('name').lean(),
  ]);
  const title = new Map(offerings.map((o) => [o._id.toString(), o.title]));
  const name = new Map(learners.map((u) => [u._id.toString(), u.name]));
  const items: FeedbackDto[] = rows.map((r) => ({
    id: r._id.toString(),
    enrollmentId: r.enrollmentId.toString(),
    offeringId: r.offeringId.toString(),
    offeringTitle: title.get(r.offeringId.toString()) ?? 'Course',
    rating: r.rating,
    comment: r.comment ?? '',
    learnerName: name.get(r.learnerUserId.toString()) ?? null,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
  const [agg] = await Feedback.aggregate<{ avg: number; n: number }>([{ $match: q }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]);
  return { items, count: agg?.n ?? 0, averageRating: agg ? Math.round(agg.avg * 100) / 100 : null };
}
