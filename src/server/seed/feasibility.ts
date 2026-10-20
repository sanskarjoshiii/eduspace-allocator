import { toMinutes } from '@/lib/utils';
import { haversineKm } from './geo';
import type { PlanCourse, PlanOffering, PlanRequest, PlanSpace, PlanWindow, SeedPlan } from './types';

/**
 * An independent re-statement of the README 13.4 hard constraints over a seed plan, used to
 * check that requests the generator meant to be feasible are, and the others are not.
 * It ignores bookings (an empty system) and the engine's scoring threshold.
 */

/** Global maximum radius (DEFAULT_SETTINGS.maxRadiusKm). Generated distances stay well below it. */
const GLOBAL_MAX_RADIUS_KM = 10;

function overlapMinutes(windows: PlanWindow[]): number {
  const first = windows[0];
  if (!first || windows.some((w) => w.dayOfWeek !== first.dayOfWeek)) return 0;
  const start = Math.max(...windows.map((w) => toMinutes(w.startTime)));
  const end = Math.min(...windows.map((w) => toMinutes(w.endTime)));
  return Math.max(0, end - start);
}

/** True when some offering window, space slot and (optional) request window share `sessionMinutes`. */
export function timeFits(offeringWindows: PlanWindow[], slots: PlanWindow[], requestWindows: PlanWindow[], sessionMinutes: number): boolean {
  const requests = requestWindows.length > 0 ? requestWindows : [null];
  for (const w of offeringWindows) {
    for (const s of slots) {
      for (const r of requests) {
        if (overlapMinutes(r ? [w, s, r] : [w, s]) >= sessionMinutes) return true;
      }
    }
  }
  return false;
}

/** Slots a class can use (blocked slots are skipped by constraint 1). */
export function openSlots(space: PlanSpace): PlanWindow[] {
  return space.slots.filter((s) => !s.isBlocked);
}

export function working(space: PlanSpace, facility: string): number {
  return space.facilities.find((f) => f.facility === facility)?.workingQuantity ?? 0;
}

/** Constraints 1-5 and 7 for a space and an offering (no learner involved). */
export function spaceSupportsOffering(space: PlanSpace, course: PlanCourse, offering: PlanOffering): boolean {
  const p = space.policy;
  if (p.categories.length > 0 && !p.categories.includes(course.category)) return false;
  if (p.audiences.length > 0 && !p.audiences.includes(offering.audience)) return false;
  if (offering.batchSize > space.seatCapacity) return false;
  if (course.requirements.some((r) => working(space, r.facility) < r.minQuantity)) return false;
  if (offering.maxRentPerHour !== null && p.rentPerHour > offering.maxRentPerHour) return false;
  return timeFits(offering.windows, openSlots(space), [], offering.sessionMinutes);
}

export function flatSpaces(plan: SeedPlan): PlanSpace[] {
  return plan.spaceGivers.flatMap((g) => g.spaces);
}

export function flatOfferings(plan: SeedPlan): { course: PlanCourse; offering: PlanOffering }[] {
  return plan.providers.flatMap((p) => p.courses.flatMap((course) => course.offerings.map((offering) => ({ course, offering }))));
}

/** Whether at least one (offering, space) pair can serve this request on an empty timetable. */
export function isRequestFeasible(plan: SeedPlan, request: PlanRequest): boolean {
  const spaces = flatSpaces(plan);
  const radius = Math.min(request.maxDistanceKm, GLOBAL_MAX_RADIUS_KM);
  const nearby = spaces.filter(
    (s) => haversineKm(request.location, s.location) <= radius && request.requiredFacilities.every((f) => working(s, f) >= 1),
  );
  if (nearby.length === 0) return false;
  for (const { course, offering } of flatOfferings(plan)) {
    if (course.category !== request.category || offering.audience !== request.audience) continue;
    const fee = offering.feePerMonth ?? 0;
    if (request.budgetPerMonth !== null && fee > request.budgetPerMonth) continue;
    for (const space of nearby) {
      if (!spaceSupportsOffering(space, course, offering)) continue;
      if (timeFits(offering.windows, openSlots(space), request.windows, offering.sessionMinutes)) return true;
    }
  }
  return false;
}
