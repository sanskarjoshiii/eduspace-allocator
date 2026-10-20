import { z } from 'zod';
import { AGE_BANDS, PARTNER_TYPES, SELF_REGISTER_ROLES } from '@/lib/domain';
import { ObjectIdString } from './common';

export const LoginInput = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof LoginInput>;

const Password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/\d/, 'Include a number');

/**
 * POST /api/auth/register. Administrators cannot self-register (the enum excludes them).
 * Learners must consent; space givers and providers name their organisation.
 */
export const RegisterInput = z
  .object({
    role: z.enum(SELF_REGISTER_ROLES),
    name: z.string().trim().min(2, 'Enter your name').max(120),
    email: z.email('Enter a valid email address').transform((e) => e.toLowerCase()),
    password: Password,
    contactPhone: z.string().trim().max(30).optional().default(''),
    // Learner
    ageBand: z.enum(AGE_BANDS).optional(),
    areaId: ObjectIdString.optional(),
    accessibilityNeeds: z.array(z.string().trim().max(100)).max(10).optional().default([]),
    consent: z.boolean().optional(),
    // Space Giver / Course Provider
    partnerType: z.enum(PARTNER_TYPES).optional(),
    organisationName: z.string().trim().max(160).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'Learner') {
      if (!v.ageBand) ctx.addIssue({ code: 'custom', path: ['ageBand'], message: 'Choose your age band' });
      if (v.consent !== true) ctx.addIssue({ code: 'custom', path: ['consent'], message: 'Consent is required to register' });
    } else {
      if (!v.partnerType) ctx.addIssue({ code: 'custom', path: ['partnerType'], message: 'Choose your organisation type' });
      if (v.role === 'SpaceGiver' && v.partnerType === 'IndividualTutor') {
        ctx.addIssue({ code: 'custom', path: ['partnerType'], message: 'Space givers register as an organisation' });
      }
      if (v.partnerType !== 'IndividualTutor' && !v.organisationName) {
        ctx.addIssue({ code: 'custom', path: ['organisationName'], message: 'Enter your organisation name' });
      }
    }
  });
export type RegisterInput = z.input<typeof RegisterInput>;
