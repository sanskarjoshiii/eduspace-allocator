import { z } from 'zod';
import { APPROVAL_MODES, AUDIENCES } from '@/lib/domain';
import { HHmm, Money, ObjectIdString, PointInput, noOverlap } from './common';

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const SpaceFacilityInput = z
  .object({
    facilityTypeId: ObjectIdString,
    quantity: z.number().int().min(0).max(10_000),
    workingQuantity: z.number().int().min(0).max(10_000),
  })
  .refine((f) => f.workingQuantity <= f.quantity, {
    message: 'Working quantity cannot exceed quantity',
    path: ['workingQuantity'],
  });
export type SpaceFacilityInput = z.infer<typeof SpaceFacilityInput>;

/** A weekly availability slot. `id` keeps an existing slot's identity on edit. */
export const SpaceSlotInput = z
  .object({
    id: ObjectIdString.optional(),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: HHmm,
    endTime: HHmm,
    isBlocked: z.boolean().optional(),
  })
  .refine((s) => toMin(s.endTime) > toMin(s.startTime), { message: 'End time must be after start time', path: ['endTime'] });
export type SpaceSlotInput = z.infer<typeof SpaceSlotInput>;

/** Space policy. Omitted fields keep their current value on edit (or the default on create). */
export const SpacePolicyInput = z.object({
  /** Empty = every category allowed. */
  allowedCategoryIds: z.array(ObjectIdString).max(100).optional(),
  /** Empty = every audience allowed. */
  allowedAudiences: z.array(z.enum(AUDIENCES)).max(AUDIENCES.length).optional(),
  rentPerHour: Money.optional(),
  approvalMode: z.enum(APPROVAL_MODES).optional(),
  rules: z.string().trim().max(2000).optional(),
});
export type SpacePolicyInput = z.infer<typeof SpacePolicyInput>;

export const PhotoInput = z.object({ url: z.url('Enter a valid URL').max(1000), publicId: z.string().trim().max(300) });

const SpaceBase = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(160),
  description: z.string().trim().max(4000).optional(),
  address: z.string().trim().max(500).optional(),
  /** GeoJSON point [lng, lat]. */
  location: PointInput,
  /** When omitted the space snaps to the nearest area (within 25 km). */
  areaId: ObjectIdString.optional(),
  isActive: z.boolean().optional(),
  seatCapacity: z.number().int().min(1, 'At least one seat').max(10_000),
  photos: z.array(PhotoInput).max(20).optional(),
  facilities: z.array(SpaceFacilityInput).max(50).optional(),
  slots: z.array(SpaceSlotInput).max(100).optional(),
  policy: SpacePolicyInput.optional(),
  /** Administrators only: create the space on behalf of this Space Giver. */
  ownerUserId: ObjectIdString.optional(),
});

function checkSpace(v: Partial<z.infer<typeof SpaceBase>>, ctx: z.RefinementCtx): void {
  if (v.slots && !noOverlap(v.slots)) {
    ctx.addIssue({ code: 'custom', path: ['slots'], message: 'Slots on the same day cannot overlap' });
  }
  if (v.facilities) {
    const ids = v.facilities.map((f) => f.facilityTypeId.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['facilities'], message: 'Each facility type can be listed once' });
    }
  }
}

/** POST /api/spaces */
export const SpaceInput = SpaceBase.superRefine(checkSpace);
export type SpaceInput = z.input<typeof SpaceInput>;

/** PATCH /api/spaces/[id]: any subset; arrays replace, policy merges. */
export const SpaceUpdate = SpaceBase.omit({ ownerUserId: true }).partial().superRefine(checkSpace);
export type SpaceUpdate = z.input<typeof SpaceUpdate>;

export const SpaceListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  mine: z.enum(['1', 'true', '0', 'false']).optional(),
  areaId: ObjectIdString.optional(),
});
