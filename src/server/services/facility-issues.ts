// Facility issues (PLAN 7.1): reporting reduces a facility's working quantity and
// triggers the reallocation re-check; resolving restores it.

import { Types } from 'mongoose';
import type { SessionUser } from '@/server/auth/session';
import { assertOwner, badRequest, conflict, isAdmin, notFound } from '@/server/http';
import { Allocation, FacilityIssue, FacilityType, Space, User } from '@/server/models';
import { audit } from '@/server/services/audit';
import { emitEvent } from '@/server/services/events';
import { adminIds } from '@/server/notifications/notify';
import { toFacilityIssueDto, type FacilityIssueDto } from '@/server/dto/facility-issue';
import { safeNotify } from '@/server/worker/lifecycle';
import type { FacilityIssueLean, SpaceLean } from '@/server/worker/types';
import type { FacilityIssueInput, FacilityIssueListQuery } from '@/schemas/facility-issue';
import { handleFacilityChange, restoreAfterResolve } from './reallocation';

type Id = Types.ObjectId;

async function toDtos(rows: FacilityIssueLean[]): Promise<FacilityIssueDto[]> {
  const [spaces, types, users, replacements] = await Promise.all([
    Space.find({ _id: { $in: rows.map((r) => r.spaceId) } }).select('name').lean(),
    FacilityType.find({ _id: { $in: rows.map((r) => r.facilityTypeId) } }).select('name').lean(),
    User.find({ _id: { $in: rows.map((r) => r.reportedBy) } }).select('name').lean(),
    Allocation.find({ replacesAllocationId: { $in: rows.flatMap((r) => r.affectedAllocationIds ?? []) } })
      .select('_id replacesAllocationId')
      .lean(),
  ]);
  const spaceName = new Map(spaces.map((s) => [s._id.toString(), s.name]));
  const typeName = new Map(types.map((t) => [t._id.toString(), t.name]));
  const userName = new Map(users.map((u) => [u._id.toString(), u.name]));
  return rows.map((r) => {
    const affected = new Set((r.affectedAllocationIds ?? []).map(String));
    return toFacilityIssueDto(r, {
      spaceName: spaceName.get(r.spaceId.toString()) ?? '',
      facilityName: typeName.get(r.facilityTypeId.toString()) ?? '',
      reportedByName: userName.get(r.reportedBy.toString()) ?? '',
      replacementAllocationIds: replacements
        .filter((x) => x.replacesAllocationId && affected.has(x.replacesAllocationId.toString()))
        .map((x) => x._id.toString()),
    });
  });
}

/** Reports an issue: working quantity drops (floor 0), booked allocations are re-checked. */
export async function reportFacilityIssue(user: SessionUser, input: FacilityIssueInput): Promise<FacilityIssueDto> {
  const space = await Space.findById(input.spaceId).lean<SpaceLean>();
  if (!space) throw notFound('Space');
  assertOwner(user, space.ownerUserId);
  const facility = space.facilities.find((f) => f.facilityTypeId.toString() === input.facilityTypeId);
  if (!facility) throw badRequest('This space does not list that facility.');
  const type = await FacilityType.findById(input.facilityTypeId).select('name').lean();

  const before = facility.workingQuantity;
  const after = Math.max(0, before - input.affectedQuantity);
  await Space.updateOne({ _id: space._id, 'facilities.facilityTypeId': facility.facilityTypeId }, { $set: { 'facilities.$.workingQuantity': after } });
  const issue = await FacilityIssue.create({
    spaceId: space._id,
    reportedBy: new Types.ObjectId(user.id),
    facilityTypeId: facility.facilityTypeId,
    affectedQuantity: input.affectedQuantity,
    description: input.description ?? '',
    evidenceUrl: input.evidenceUrl ?? '',
  });
  await audit({
    actor: user,
    action: 'create',
    entity: 'FacilityIssue',
    entityId: issue._id,
    ownerUserId: space.ownerUserId,
    diff: { facility: type?.name ?? '', workingQuantity: { from: before, to: after } },
  });
  await emitEvent('facilityIssue.reported', issue._id, { spaceId: space._id.toString() });

  const change = await handleFacilityChange(space._id, { quantity: input.affectedQuantity, facilityName: type?.name ?? 'units' }, user);
  await FacilityIssue.updateOne({ _id: issue._id }, { $set: { affectedAllocationIds: change.affectedAllocationIds } });
  await safeNotify({
    type: 'facility.issueReported',
    userIds: await adminIds(),
    vars: { spaceName: space.name, quantity: input.affectedQuantity, facilityName: type?.name ?? '', affectedCount: change.affectedAllocationIds.length },
    related: { type: 'FacilityIssue', id: issue._id },
    href: '/facility-issues',
  });
  const fresh = await FacilityIssue.findById(issue._id).lean<FacilityIssueLean>();
  return (await toDtos([fresh!]))[0]!;
}

/** Resolves an issue: working quantity is restored (capped at the installed quantity). */
export async function resolveFacilityIssue(user: SessionUser, id: Id, note?: string): Promise<FacilityIssueDto> {
  const issue = await FacilityIssue.findById(id).lean<FacilityIssueLean>();
  if (!issue) throw notFound('Facility issue');
  const space = await Space.findById(issue.spaceId).lean<SpaceLean>();
  if (!space) throw notFound('Space');
  assertOwner(user, space.ownerUserId);
  const claimed = await FacilityIssue.updateOne(
    { _id: issue._id, status: 'Open' },
    { $set: { status: 'Resolved', resolvedAt: new Date(), resolvedBy: new Types.ObjectId(user.id) } },
  );
  if (claimed.modifiedCount === 0) throw conflict('This issue is already resolved.');

  const facility = space.facilities.find((f) => f.facilityTypeId.toString() === issue.facilityTypeId.toString());
  const restored = facility ? Math.min(facility.quantity, facility.workingQuantity + issue.affectedQuantity) : null;
  if (facility && restored !== null) {
    await Space.updateOne({ _id: space._id, 'facilities.facilityTypeId': facility.facilityTypeId }, { $set: { 'facilities.$.workingQuantity': restored } });
  }
  await audit({
    actor: user,
    action: 'update',
    entity: 'FacilityIssue',
    entityId: issue._id,
    ownerUserId: space.ownerUserId,
    diff: {
      status: { from: 'Open', to: 'Resolved' },
      ...(facility ? { workingQuantity: { from: facility.workingQuantity, to: restored } } : {}),
      ...(note ? { note } : {}),
    },
  });
  await emitEvent('facilityIssue.resolved', issue._id, { spaceId: space._id.toString() });
  await restoreAfterResolve(issue.affectedAllocationIds ?? [], user);
  const fresh = await FacilityIssue.findById(issue._id).lean<FacilityIssueLean>();
  return (await toDtos([fresh!]))[0]!;
}

export async function getFacilityIssue(user: SessionUser, id: Id): Promise<FacilityIssueDto> {
  const rows = await listFacilityIssues(user, {});
  const found = rows.find((r) => r.id === id.toString());
  if (!found) throw notFound('Facility issue');
  return found;
}

/** Scoped list: space givers see their spaces, providers spaces hosting their classes, admins all. */
export async function listFacilityIssues(user: SessionUser, q: FacilityIssueListQuery): Promise<FacilityIssueDto[]> {
  const filter: Record<string, unknown> = {};
  const me = new Types.ObjectId(user.id);
  let spaceIds: Id[] | null = null;
  if (user.role === 'SpaceGiver') {
    spaceIds = (await Space.find({ ownerUserId: me }).select('_id').lean()).map((s) => s._id);
  } else if (user.role === 'CourseProvider') {
    spaceIds = (await Allocation.distinct('spaceId', { providerUserId: me })) as Id[];
  } else if (!isAdmin(user)) {
    return [];
  }
  if (spaceIds) filter.spaceId = { $in: q.spaceId ? spaceIds.filter((s) => s.toString() === q.spaceId) : spaceIds };
  else if (q.spaceId) filter.spaceId = new Types.ObjectId(q.spaceId);
  if (q.status) filter.status = q.status;
  const rows = await FacilityIssue.find(filter).sort({ createdAt: -1 }).limit(500).lean<FacilityIssueLean[]>();
  return toDtos(rows);
}
