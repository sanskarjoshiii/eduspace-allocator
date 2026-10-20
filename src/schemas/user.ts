import { z } from 'zod';
import { AGE_BANDS, PARTNER_TYPES, ROLES, USER_STATUSES } from '@/lib/domain';
import { ObjectIdString } from './common';

/** PATCH /api/me */
export const MeUpdate = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  emailNotifications: z.boolean().optional(),
  // Learner only
  accessibilityNeeds: z.array(z.string().trim().max(100)).max(10).optional(),
  areaId: ObjectIdString.nullable().optional(),
});
export type MeUpdate = z.infer<typeof MeUpdate>;

/** POST /api/users (Administrator). Any role, including Administrator. */
export const CreateUserInput = z
  .object({
    role: z.enum(ROLES),
    name: z.string().trim().min(2, 'Enter a name').max(120),
    email: z.email('Enter a valid email address').transform((e) => e.toLowerCase()),
    password: z
      .string()
      .min(10, 'Use at least 10 characters')
      .max(200)
      .regex(/[A-Za-z]/, 'Include a letter')
      .regex(/\d/, 'Include a number'),
    status: z.enum(['Active', 'PendingApproval']).optional(),
    contactPhone: z.string().trim().max(30).optional(),
    // Learner
    ageBand: z.enum(AGE_BANDS).optional(),
    areaId: ObjectIdString.optional(),
    accessibilityNeeds: z.array(z.string().trim().max(100)).max(10).optional(),
    // Space Giver / Course Provider
    partnerType: z.enum(PARTNER_TYPES).optional(),
    organisationName: z.string().trim().max(160).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'Learner' && !v.ageBand) ctx.addIssue({ code: 'custom', path: ['ageBand'], message: 'Choose an age band' });
    if (v.role === 'SpaceGiver' || v.role === 'CourseProvider') {
      if (!v.partnerType) ctx.addIssue({ code: 'custom', path: ['partnerType'], message: 'Choose an organisation type' });
      if (v.role === 'SpaceGiver' && v.partnerType === 'IndividualTutor') {
        ctx.addIssue({ code: 'custom', path: ['partnerType'], message: 'Space givers register as an organisation' });
      }
      if (v.partnerType && v.partnerType !== 'IndividualTutor' && !v.organisationName) {
        ctx.addIssue({ code: 'custom', path: ['organisationName'], message: 'Enter the organisation name' });
      }
    }
  });
export type CreateUserInput = z.input<typeof CreateUserInput>;

/** PATCH /api/users/[id] (Administrator). */
export const UserUpdate = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120).optional(),
  status: z.enum(['Active', 'Suspended']).optional(),
});
export type UserUpdate = z.infer<typeof UserUpdate>;

export const UserListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

/** POST /api/uploads/sign */
export const UPLOAD_KINDS = ['space-photo', 'logo', 'course-cover', 'facility-evidence'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
export const UploadSignInput = z.object({ kind: z.enum(UPLOAD_KINDS) });
export type UploadSignInput = z.infer<typeof UploadSignInput>;
