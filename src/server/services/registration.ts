import bcrypt from 'bcryptjs';
import type { z } from 'zod';
import { withTransaction } from '@/lib/db';
import { ROLE_LABEL, type AgeBand, type PartnerType, type Role, type UserStatus } from '@/lib/domain';
import { LearnerProfile, Partner, User } from '@/server/models';
import { conflict, type SessionUser } from '@/server/http';
import { audit } from '@/server/services/audit';
import { getSettings } from '@/server/services/settings';
import { adminIds, notify } from '@/server/notifications/notify';
import {
  learnerProfileDto,
  partnerDto,
  userDto,
  type AccountDto,
  type LearnerProfileRecord,
  type PartnerRecord,
  type UserRecord,
} from '@/server/dto/user';
import type { RegisterInput } from '@/schemas/auth';
import { requireArea } from './areas';

export const PASSWORD_COST = 10;

export interface AccountInput {
  role: Role;
  name: string;
  email: string;
  password: string;
  contactPhone?: string;
  ageBand?: AgeBand;
  areaId?: string;
  accessibilityNeeds?: string[];
  partnerType?: PartnerType;
  organisationName?: string;
}

const duplicateEmail = () => conflict('An account with this email already exists.', { fieldErrors: { email: ['An account with this email already exists'] } });

/**
 * Creates a user plus the LearnerProfile or Partner its role needs, and links it
 * through ownerRefId. Shared by self-registration and the administrator Users page.
 */
export async function createAccount(
  input: AccountInput,
  opts: { status: UserStatus; actor: SessionUser | null; consentAt: Date | null },
): Promise<AccountDto> {
  const email = input.email.toLowerCase();
  if (await User.exists({ email })) throw duplicateEmail();
  if (input.role === 'Learner' && input.areaId) await requireArea(input.areaId);
  const passwordHash = await bcrypt.hash(input.password, PASSWORD_COST);

  let created: { user: UserRecord; profile?: LearnerProfileRecord; partner?: PartnerRecord };
  try {
    created = await withTransaction(async (session) => {
      const opt = { session: session ?? undefined };
      const [user] = await User.create([{ email, name: input.name, role: input.role, status: opts.status, passwordHash }], opt);
      if (!user) throw new Error('user.create returned nothing');
      let profile: LearnerProfileRecord | undefined;
      let partner: PartnerRecord | undefined;
      if (input.role === 'Learner') {
        const [p] = await LearnerProfile.create(
          [
            {
              userId: user._id,
              name: input.name,
              ageBand: input.ageBand,
              contactPhone: input.contactPhone ?? '',
              contactEmail: email,
              areaId: input.areaId ?? null,
              accessibilityNeeds: input.accessibilityNeeds ?? [],
              consentAt: opts.consentAt,
            },
          ],
          opt,
        );
        profile = p!.toObject() as LearnerProfileRecord;
        user.set('ownerRefId', p!._id);
      } else if (input.role === 'SpaceGiver' || input.role === 'CourseProvider') {
        const [p] = await Partner.create(
          [
            {
              userId: user._id,
              type: input.partnerType,
              name: input.organisationName?.trim() || input.name,
              contactPhone: input.contactPhone ?? '',
            },
          ],
          opt,
        );
        partner = p!.toObject() as PartnerRecord;
        user.set('ownerRefId', p!._id);
      }
      await user.save(opt);
      return { user: user.toObject() as UserRecord, profile, partner };
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw duplicateEmail();
    throw err;
  }

  const userId = String(created.user._id);
  const actor: SessionUser = opts.actor ?? {
    id: userId,
    email,
    name: input.name,
    role: input.role,
    ownerRefId: created.user.ownerRefId ? String(created.user.ownerRefId) : null,
    status: opts.status,
  };
  await audit({
    actor,
    action: 'create',
    entity: 'User',
    entityId: userId,
    ownerUserId: userId,
    diff: { email, name: input.name, role: input.role, status: opts.status, selfRegistered: opts.actor === null },
  });

  const out: AccountDto = { user: userDto(created.user) };
  if (created.profile) out.profile = learnerProfileDto(created.profile);
  if (created.partner) out.partner = partnerDto(created.partner);
  return out;
}

/** POST /api/auth/register: self-registration for Learner, Space Giver and Course Provider. */
export async function register(input: z.output<typeof RegisterInput>): Promise<AccountDto> {
  const settings = await getSettings();
  const needsApproval = input.role !== 'Learner' && settings.requirePartnerApproval;
  const status: UserStatus = needsApproval ? 'PendingApproval' : 'Active';
  const account = await createAccount(
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
    { status, actor: null, consentAt: input.role === 'Learner' ? new Date() : null },
  );
  await notify({
    type: 'account.created',
    userIds: await adminIds(),
    vars: {
      name: input.name,
      roleLabel: ROLE_LABEL[input.role],
      approvalNote: needsApproval ? ' and is waiting for your approval' : '',
    },
    related: { type: 'User', id: account.user.id },
    href: '/users',
  });
  return account;
}
