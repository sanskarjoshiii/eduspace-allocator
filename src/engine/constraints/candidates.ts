import type { EngineContext } from '../context';
import type { EngineOffering, EngineSpace, TimeWindow } from '../types';
import { formatWindow, overlapMinutes, overlapWithUnion, sameWindow, subtractWindows, windowMinutes } from '../util/time';

export type Slot = EngineSpace['slots'][number];

/** One free sub-window of an open slot: a right-hand node in space matching. */
export interface SlotNode {
  index: number;
  spaceId: string;
  slotId: string;
  slot: Slot;
  free: TimeWindow;
}

/** Where the offering's session would sit, and how well it fits the provider's windows. */
export type Placement =
  | { ok: true; session: TimeWindow; overlap: number; detail: string }
  | { ok: false; session: null; overlap: 0; detail: string };

function fail(detail: string): Placement {
  return { ok: false, session: null, overlap: 0, detail };
}

/** Free sub-windows of a slot after removing bookings. */
export function freeWindows(ctx: EngineContext, space: EngineSpace, slot: Slot): TimeWindow[] {
  return subtractWindows(slot, ctx.bookingsBySpace.get(space.id) ?? []);
}

/** All free sub-windows of unblocked slots on active spaces, in snapshot order. */
export function buildSlotNodes(ctx: EngineContext): SlotNode[] {
  const nodes: SlotNode[] = [];
  for (const space of ctx.snapshot.spaces) {
    if (!space.isActive) continue;
    for (const slot of space.slots) {
      if (slot.isBlocked) continue;
      for (const free of freeWindows(ctx, space, slot)) {
        nodes.push({ index: nodes.length, spaceId: space.id, slotId: slot.slotId, slot, free });
      }
    }
  }
  return nodes;
}

function timeDetail(session: TimeWindow, overlap: number, offering: EngineOffering): string {
  if (offering.windows.length === 0) return `${formatWindow(session)}; the provider can teach any time`;
  if (overlap >= offering.sessionMinutes) return `${formatWindow(session)} fits the provider's preferred time`;
  return `${formatWindow(session)}: ${overlap} of ${offering.sessionMinutes} min inside the provider's preferred time`;
}

/**
 * Places the offering's session in a free sub-window: at the earliest start that maximises
 * overlap with one of the provider's windows (at the window start when it has none).
 */
export function placeInFreeWindow(free: TimeWindow, offering: EngineOffering): Placement {
  const len = offering.sessionMinutes;
  const freeLen = windowMinutes(free);
  if (freeLen < len) return fail(`Free time ${formatWindow(free)} is ${freeLen} min, the session needs ${len} min`);
  if (offering.windows.length === 0) {
    const session = { dayOfWeek: free.dayOfWeek, start: free.start, end: free.start + len };
    return { ok: true, session, overlap: len, detail: timeDetail(session, len, offering) };
  }
  let best: TimeWindow | null = null;
  let bestOverlap = 0;
  for (const w of offering.windows) {
    if (w.dayOfWeek !== free.dayOfWeek || overlapMinutes(w, free) <= 0) continue;
    // Earliest maximiser of overlap with w, clamped into the free window.
    const target = Math.min(w.start, w.end - len);
    const start = Math.min(Math.max(target, free.start), free.end - len);
    const session = { dayOfWeek: free.dayOfWeek, start, end: start + len };
    const ov = overlapMinutes(session, w);
    if (ov > bestOverlap || (ov === bestOverlap && best !== null && start < best.start)) {
      best = session;
      bestOverlap = ov;
    }
  }
  if (!best || bestOverlap <= 0) {
    const pref = offering.windows.map(formatWindow).join(', ');
    return fail(`Free time ${formatWindow(free)} misses the provider's preferred times (${pref})`);
  }
  const overlap = Math.min(len, overlapWithUnion(best, offering.windows));
  return { ok: true, session: best, overlap, detail: timeDetail(best, overlap, offering) };
}

/**
 * Checks an already chosen session (used for re-checks): it must lie in a slot, last the
 * session length, avoid bookings (except `ignore`, the allocation's own booking) and
 * overlap the provider's windows when it has any.
 */
export function placeGivenSession(
  ctx: EngineContext,
  space: EngineSpace,
  offering: EngineOffering,
  session: TimeWindow,
  ignore: TimeWindow | null,
): { slot: Slot | null; placement: Placement } {
  const containing = space.slots.filter(
    (s) => s.dayOfWeek === session.dayOfWeek && session.start >= s.start && session.end <= s.end,
  );
  const slot = containing.find((s) => !s.isBlocked) ?? containing[0] ?? null;
  if (!slot) return { slot, placement: fail(`${formatWindow(session)} is outside the space's weekly slots`) };
  const len = windowMinutes(session);
  if (len < offering.sessionMinutes) {
    return { slot, placement: fail(`${formatWindow(session)} is ${len} min, the session needs ${offering.sessionMinutes} min`) };
  }
  let skipped = false;
  for (const b of ctx.bookingsBySpace.get(space.id) ?? []) {
    if (!skipped && ignore && sameWindow(b, ignore)) {
      skipped = true;
      continue;
    }
    if (overlapMinutes(b, session) > 0) {
      return { slot, placement: fail(`${formatWindow(session)} clashes with a booking at ${formatWindow(b)}`) };
    }
  }
  let overlap = offering.sessionMinutes;
  if (offering.windows.length > 0) {
    overlap = Math.min(offering.sessionMinutes, overlapWithUnion(session, offering.windows));
    if (overlap <= 0) {
      const pref = offering.windows.map(formatWindow).join(', ');
      return { slot, placement: fail(`${formatWindow(session)} misses the provider's preferred times (${pref})`) };
    }
  }
  return { slot, placement: { ok: true, session, overlap, detail: timeDetail(session, overlap, offering) } };
}
