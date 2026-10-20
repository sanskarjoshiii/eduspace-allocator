import { describe, expect, it } from 'vitest';
import { buildSlotNodes, placeGivenSession, placeInFreeWindow } from '@/engine/constraints/candidates';
import { evaluateConstraints } from '@/engine/constraints/check';
import { buildContext, centreDistance } from '@/engine/context';
import type { EngineOffering, EngineSnapshot, EngineSpace } from '@/engine/types';
import { CONSTRAINT_ORDER } from '@/engine/types';
import { SAT, SUN, baseSnapshot, hm, offering, request, settings, space, win } from './fixtures';

const KATRAJ = { lng: 73.857, lat: 18.452 };

function goodSpace(over: Partial<EngineSpace> = {}): EngineSpace {
  return space({
    id: 'sp',
    name: 'Test Hall',
    location: KATRAJ,
    seatCapacity: 20,
    facilities: [{ facilityTypeId: 'computer', quantity: 20, workingQuantity: 20 }],
    ...over,
  });
}

function goodOffering(over: Partial<EngineOffering> = {}): EngineOffering {
  return offering({ id: 'of', batchSize: 18, requirements: [{ facilityTypeId: 'computer', minQuantity: 18 }], ...over });
}

/** Evaluates the first slot of the (single) space via the same path the pipeline uses. */
function evaluate(sp: EngineSpace, of: EngineOffering, extra: Partial<EngineSnapshot> = {}) {
  const snap = baseSnapshot({ spaces: [sp], offerings: [of], requests: [request({ id: 'r1', location: KATRAJ })], ...extra });
  const ctx = buildContext(snap, settings());
  const slot = sp.slots[0] ?? null;
  const placement = slot && !slot.isBlocked && sp.isActive
    ? placeInFreeWindow(slot, of)
    : ({ ok: false, session: null, overlap: 0, detail: 'Slot not open' } as const);
  return evaluateConstraints(ctx, { space: sp, offering: of, slot, placement, distance: centreDistance(ctx, of, sp.location) });
}

function detailOf(ev: ReturnType<typeof evaluate>, name: (typeof CONSTRAINT_ORDER)[number]): string {
  return ev.results.find((r) => r.constraint === name)?.detail ?? '';
}

describe('hard constraints', () => {
  it('passes all seven in order for a good pair', () => {
    const ev = evaluate(goodSpace(), goodOffering());
    expect(ev.firstFailure).toBeNull();
    expect(ev.results.map((r) => r.constraint)).toEqual([...CONSTRAINT_ORDER]);
    expect(ev.results.every((r) => r.passed && r.detail.length > 0)).toBe(true);
    expect(detailOf(ev, 'facilities')).toBe('20 working computers, the course needs 18');
  });

  it('1 active: inactive space or blocked slot', () => {
    expect(evaluate(goodSpace({ isActive: false }), goodOffering()).firstFailure).toBe('active');
    const blocked = evaluate(
      goodSpace({ slots: [{ slotId: 'b', dayOfWeek: SAT, start: hm(9), end: hm(13), isBlocked: true }] }),
      goodOffering(),
    );
    expect(blocked.firstFailure).toBe('active');
    expect(detailOf(blocked, 'active')).toBe('Slot Sat 09:00–13:00 is blocked by the owner');
  });

  it('2 time: too short, outside preferred windows, clashing bookings', () => {
    const short = evaluate(goodSpace({ slots: [{ slotId: 's', dayOfWeek: SAT, start: hm(10), end: hm(11), isBlocked: false }] }), goodOffering());
    expect(short.firstFailure).toBe('time');
    expect(detailOf(short, 'time')).toBe('Free time Sat 10:00–11:00 is 60 min, the session needs 120 min');

    const wrongDay = evaluate(goodSpace({ slots: [{ slotId: 'd', dayOfWeek: SUN, start: hm(9), end: hm(13), isBlocked: false }] }), goodOffering());
    expect(wrongDay.firstFailure).toBe('time');

    // A booking leaves only 09:00-10:00 free in the morning: nodes never include booked time.
    const sp = goodSpace({ bookings: [win(SAT, hm(10), hm(13))] });
    const ctx = buildContext(baseSnapshot({ spaces: [sp], offerings: [goodOffering()] }), settings());
    const nodes = buildSlotNodes(ctx);
    expect(nodes.map((n) => [n.free.start, n.free.end])).toEqual([[hm(9), hm(10)]]);
    const given = placeGivenSession(ctx, sp, goodOffering(), win(SAT, hm(10), hm(12)), null);
    expect(given.placement.ok).toBe(false);
    expect(given.placement.detail).toContain('clashes with a booking');
    // Ignoring its own booking, the same session is fine.
    const own = placeGivenSession(ctx, sp, goodOffering(), win(SAT, hm(10), hm(12)), win(SAT, hm(10), hm(13)));
    expect(own.placement.ok).toBe(true);
  });

  it('places the session at the earliest start that maximises overlap', () => {
    const p = placeInFreeWindow(win(SAT, hm(9), hm(13)), goodOffering({ windows: [win(SAT, hm(10), hm(12))] }));
    expect(p.ok && p.session).toEqual(win(SAT, hm(10), hm(12)));
    const flexible = placeInFreeWindow(win(SAT, hm(9), hm(13)), goodOffering({ windows: [] }));
    expect(flexible.ok && flexible.session).toEqual(win(SAT, hm(9), hm(11)));
    const partial = placeInFreeWindow(win(SAT, hm(11), hm(15)), goodOffering({ windows: [win(SAT, hm(10), hm(12))] }));
    expect(partial.ok && partial.session).toEqual(win(SAT, hm(11), hm(13)));
    expect(partial.overlap).toBe(60);
  });

  it('3 capacity: seats below batch size', () => {
    const ev = evaluate(goodSpace({ seatCapacity: 12 }), goodOffering());
    expect(ev.firstFailure).toBe('capacity');
    expect(detailOf(ev, 'capacity')).toBe('12 seats, the batch needs 18');
  });

  it('4 facilities: counts working quantity, not total', () => {
    const ev = evaluate(goodSpace({ facilities: [{ facilityTypeId: 'computer', quantity: 25, workingQuantity: 17 }] }), goodOffering());
    expect(ev.firstFailure).toBe('facilities');
    expect(detailOf(ev, 'facilities')).toBe('17 working computers, the course needs 18');
  });

  it('5 policy: category and audience', () => {
    const cat = evaluate(goodSpace({ policy: { allowedCategoryIds: ['music'], allowedAudiences: [], rentPerHour: 300, approvalMode: 'auto' } }), goodOffering());
    expect(cat.firstFailure).toBe('policy');
    expect(detailOf(cat, 'policy')).toBe('Space policy does not allow Coding');
    const aud = evaluate(goodSpace({ policy: { allowedCategoryIds: [], allowedAudiences: ['Adults'], rentPerHour: 300, approvalMode: 'auto' } }), goodOffering());
    expect(aud.firstFailure).toBe('policy');
  });

  it('6 distance: from the cohort centre against the global radius', () => {
    // ~6.2 km north of Katraj.
    const far = { lng: KATRAJ.lng, lat: KATRAJ.lat + 6.2 / 111.2 };
    const ev = evaluate(goodSpace({ location: far }), goodOffering());
    expect(ev.firstFailure).toBe('distance');
    expect(detailOf(ev, 'distance')).toBe('6.2 km from the cohort centre, limit 5 km');
  });

  it('7 budget: rent above max rent per hour', () => {
    const ev = evaluate(
      goodSpace({ policy: { allowedCategoryIds: [], allowedAudiences: [], rentPerHour: 600, approvalMode: 'auto' } }),
      goodOffering({ maxRentPerHour: 450 }),
    );
    expect(ev.firstFailure).toBe('budget');
    expect(detailOf(ev, 'budget')).toBe('₹600 per hour, budget ₹450 per hour');
  });

  it('records only the first failure when several fail', () => {
    const ev = evaluate(goodSpace({ seatCapacity: 5, facilities: [] }), goodOffering());
    expect(ev.firstFailure).toBe('capacity');
    expect(ev.results.filter((r) => !r.passed).map((r) => r.constraint)).toEqual(['capacity', 'facilities']);
  });
});
