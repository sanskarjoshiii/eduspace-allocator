import type { z } from 'zod';
import { LearnerProfile, Partner, User } from '@/server/models';
import { notFound, pageMeta, type SessionUser } from '@/server/http';
import { audit, diffOf } from '@/server/services/audit';
import {
  learnerProfileDto,
  partnerDto,
  userDto,
  type AccountDto,
  type LearnerProfileRecord,
  type PartnerRecord,
  type UserDto,
  type UserRecord,
} from '@/server/dto/user';
import type { CreateUserInput, MeUpdate, UserListQuery, UserUpdate } from '@/schemas/user';
import { requireArea, unprocessable } from './areas';
import { escapeRegex } from './lookups';
import { createAccount } from './registration';

const USER_FIELDS = 'email name role status ownerRefId emailNotifications lastLoginAt createdAt updatedAt';

async function accountOf(user: UserRecord): Promise<AccountDto> {
  const out: AccountDto = { user: userDto(user) };
  if (user.role === 'Learner') {
    const p = await LearnerProfile.findOne({ userId: user._id }).lean<LearnerProfileRecord>();
    if (p) out.profile = learnerProfileDto(p);
  } else if (user.role === 'SpaceGiver' || user.role === 'CourseProvider') {
    const p = await Partner.findOne({ userId: user._id }).lean<PartnerRecord>();
    if (p) out.partner = partnerDto(p);
  }
  return out;
}

/** GET /api/me */
export async function getMe(me: SessionUser): Promise<AccountDto> {
  const u = await User.findById(me.id).select(USER_FIELDS).lean<UserRecord>();
  if (!u) throw notFound('Account');
  return accountOf(u);
}

/** PATCH /api/me */
export async function updateMe(me: SessionUser, input: MeUpdate): Promise<AccountDto> {
  const user = await User.findById(me.id).select(USER_FIELDS);
  if (!user) throw notFound('Account');
  const before = await accountOf(user.toObject() as UserRecord);

  if (input.name !== undefined) user.name = input.name;
  if (input.emailNotifications !== undefined) user.emailNotifications = input.emailNotifications;
  await user.save();

  if (user.role === 'Learner') {
    if (input.areaId) await requireArea(input.areaId);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.contactPhone !== undefined) set.contactPhone = input.contactPhone;
    if (input.accessibilityNeeds !== undefined) set.accessibilityNeeds = input.accessibilityNeeds;
    if (input.areaId !== undefined) set.areaId = input.areaId;
    if (Object.keys(set).length) await LearnerProfile.updateOne({ userId: user._id }, { $set: set });
  } else if (user.role === 'SpaceGiver' || user.role === 'CourseProvider') {
    if (input.accessibilityNeeds !== undefined || input.areaId !== undefined) {
      throw unprocessable('Only learners have accessibility needs and a home area');
    }
    if (input.contactPhone !== undefined) await Partner.updateOne({ userId: user._id }, { $set: { contactPhone: input.contactPhone } });
  } else if (input.contactPhone !== undefined || input.accessibilityNeeds !== undefined || input.areaId !== undefined) {
    throw unprocessable('Administrators have no profile to update');
  }

  const after = await accountOf(user.toObject() as UserRecord);
  await audit({
    actor: me,
    action: 'update',
    entity: 'User',
    entityId: me.id,
    ownerUserId: me.id,
    diff: {
      ...diffOf({ ...before.user }, { ...after.user }),
      ...(before.profile && after.profile ? diffOf({ ...before.profile }, { ...after.profile }) : {}),
      ...(before.partner && after.partner ? diffOf({ ...before.partner }, { ...after.partner }) : {}),
    },
  });
  return after;
}

/** GET /api/users (Administrator). */
export async function listUsers(query: z.output<typeof UserListQuery>) {
  const filter: Record<string, unknown> = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.q) {
    const rx = { $regex: escapeRegex(query.q), $options: 'i' };
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [total, rows] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .select(USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<UserRecord[]>(),
  ]);
  return { items: rows.map(userDto), ...pageMeta(total, query.page, query.pageSize) };
}

/** GET /api/users/[id] (Administrator). */
export async function getUser(id: string): Promise<AccountDto> {
  const u = await User.findById(id).select(USER_FIELDS).lean<UserRecord>();
  if (!u) throw notFound('User');
  return accountOf(u);
}

/** POST /api/users (Administrator): any role, including Administrator. */
export async function adminCreateUser(actor: SessionUser, input: z.output<typeof CreateUserInput>): Promise<AccountDto> {
  return createAccount(
    {
      role: input.role,
      name: input.name,
      email: input.email,
      password: input.password,
      contactPhone: input.contactPhone,
      ageBand: input.ageBand,
      areaId: input.areaId,
      accessibilityNeeds: input.accessibilityNeeds,
      partnerType: input.partnerType,
      organisationName: input.organisationName,
    },
    { status: input.status ?? 'Active', actor, consentAt: null },
  );
}

/** PATCH /api/users/[id] (Administrator): rename, approve, suspend or reactivate. */
export async function updateUser(actor: SessionUser, id: string, input: UserUpdate): Promise<UserDto> {
  const user = await User.findById(id).select(USER_FIELDS);
  if (!user) throw notFound('User');
  if (input.status && input.status !== 'Active' && String(user._id) === actor.id) {
    throw unprocessable('You cannot suspend your own account', 'status');
  }
  const before = userDto(user.toObject() as UserRecord);
  if (input.name !== undefined) {
    user.name = input.name;
    if (user.role === 'Learner') await LearnerProfile.updateOne({ userId: user._id }, { $set: { name: input.name } });
  }
  if (input.status !== undefined) user.status = input.status;
  await user.save();
  const after = userDto(user.toObject() as UserRecord);
  const action = input.status && input.status !== before.status ? (input.status === 'Suspended' ? 'suspend' : before.status === 'PendingApproval' ? 'approve' : 'reactivate') : 'update';
  await audit({ actor, action, entity: 'User', entityId: user._id, ownerUserId: user._id, diff: diffOf({ ...before }, { ...after }) });
  return after;
}
