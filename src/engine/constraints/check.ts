import { type CentreDistance, type EngineContext, categoryName, facilityLabel } from '../context';
import { CONSTRAINT_ORDER, type ConstraintName, type ConstraintResult, type EngineOffering, type EngineSpace } from '../types';
import { formatKm, formatLimitKm, formatRupees } from '../util/format';
import { formatWindow } from '../util/time';
import type { Placement, Slot } from './candidates';

export interface PairInput {
  space: EngineSpace;
  offering: EngineOffering;
  /** The slot the session sits in; null when no slot holds it. */
  slot: Slot | null;
  placement: Placement;
  /** Distance to the offering's demand centre (null = no centre, constraint skipped). */
  distance: CentreDistance | null;
}

export interface ConstraintEvaluation {
  results: ConstraintResult[];
  firstFailure: ConstraintName | null;
}

type Check = { passed: boolean; detail: string };

export function checkActive(space: EngineSpace, slot: Slot | null): Check {
  if (!space.isActive) return { passed: false, detail: `${space.name} is not active` };
  if (slot?.isBlocked) return { passed: false, detail: `Slot ${formatWindow(slot)} is blocked by the owner` };
  return { passed: true, detail: slot ? `Space active; slot ${formatWindow(slot)} is open` : 'Space active' };
}

export function checkTime(placement: Placement): Check {
  return { passed: placement.ok, detail: placement.detail };
}

export function checkCapacity(space: EngineSpace, offering: EngineOffering): Check {
  const passed = space.seatCapacity >= offering.batchSize;
  return {
    passed,
    detail: passed
      ? `${space.seatCapacity} seats for a batch of ${offering.batchSize}`
      : `${space.seatCapacity} seats, the batch needs ${offering.batchSize}`,
  };
}

/** Working quantity of a facility type at a space (sums duplicate entries). */
export function workingQuantity(space: EngineSpace, facilityTypeId: string): number {
  let q = 0;
  for (const f of space.facilities) if (f.facilityTypeId === facilityTypeId) q += f.workingQuantity;
  return q;
}

export function checkFacilities(ctx: EngineContext, space: EngineSpace, offering: EngineOffering): Check {
  if (offering.requirements.length === 0) return { passed: true, detail: 'No special facilities needed' };
  const parts: string[] = [];
  for (const req of offering.requirements) {
    const working = workingQuantity(space, req.facilityTypeId);
    const text = `${working} working ${facilityLabel(ctx, req.facilityTypeId)}, the course needs ${req.minQuantity}`;
    if (working < req.minQuantity) return { passed: false, detail: text };
    parts.push(text);
  }
  return { passed: true, detail: parts.join('; ') };
}

export function checkPolicy(ctx: EngineContext, space: EngineSpace, offering: EngineOffering): Check {
  const cat = categoryName(ctx, offering.categoryId);
  const { allowedCategoryIds, allowedAudiences } = space.policy;
  if (allowedCategoryIds.length > 0 && !allowedCategoryIds.includes(offering.categoryId)) {
    return { passed: false, detail: `Space policy does not allow ${cat}` };
  }
  if (allowedAudiences.length > 0 && !allowedAudiences.includes(offering.audience)) {
    return { passed: false, detail: `Space policy does not allow ${offering.audience} learners` };
  }
  return { passed: true, detail: `Policy allows ${cat} for ${offering.audience}` };
}

export function checkDistance(distance: CentreDistance | null, maxRadiusKm: number): Check {
  if (!distance) return { passed: true, detail: 'No learners or target area yet; distance not checked' };
  return {
    passed: distance.km <= maxRadiusKm,
    detail: `${formatKm(distance.km)} from the ${distance.label}, limit ${formatLimitKm(maxRadiusKm)}`,
  };
}

export function checkBudget(space: EngineSpace, offering: EngineOffering): Check {
  const rent = space.policy.rentPerHour;
  if (offering.maxRentPerHour === null) return { passed: true, detail: `${formatRupees(rent)} per hour, no budget limit` };
  return {
    passed: rent <= offering.maxRentPerHour,
    detail: `${formatRupees(rent)} per hour, budget ${formatRupees(offering.maxRentPerHour)} per hour`,
  };
}

/** Evaluates all seven hard constraints in CONSTRAINT_ORDER and reports the first failure. */
export function evaluateConstraints(ctx: EngineContext, input: PairInput): ConstraintEvaluation {
  const { space, offering } = input;
  const checks: Record<ConstraintName, () => Check> = {
    active: () => checkActive(space, input.slot),
    time: () => checkTime(input.placement),
    capacity: () => checkCapacity(space, offering),
    facilities: () => checkFacilities(ctx, space, offering),
    policy: () => checkPolicy(ctx, space, offering),
    distance: () => checkDistance(input.distance, ctx.settings.maxRadiusKm),
    budget: () => checkBudget(space, offering),
  };
  let firstFailure: ConstraintName | null = null;
  const results = CONSTRAINT_ORDER.map((constraint) => {
    const c = checks[constraint]();
    if (!c.passed && firstFailure === null) firstFailure = constraint;
    return { constraint, passed: c.passed, detail: c.detail };
  });
  return { results, firstFailure };
}

/** Fast path: true when every constraint passes. Used to build matching edges. */
export function isFeasible(ctx: EngineContext, input: PairInput): boolean {
  const { space, offering } = input;
  return (
    checkActive(space, input.slot).passed &&
    input.placement.ok &&
    space.seatCapacity >= offering.batchSize &&
    offering.requirements.every((r) => workingQuantity(space, r.facilityTypeId) >= r.minQuantity) &&
    checkPolicy(ctx, space, offering).passed &&
    (input.distance === null || input.distance.km <= ctx.settings.maxRadiusKm) &&
    (offering.maxRentPerHour === null || space.policy.rentPerHour <= offering.maxRentPerHour)
  );
}
