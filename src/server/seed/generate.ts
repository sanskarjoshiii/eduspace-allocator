import { audienceForAgeBand, type AgeBand, type Audience } from '@/lib/domain';
import { toHHmm, toMinutes } from '@/lib/utils';
import { AREAS, NO_SPACE_AREAS, SOUTH_PUNE, areaByName, type AreaSeed } from './data/areas';
import { CATEGORY_POPULARITY, LEAF_CATEGORIES, UNOFFERED_CATEGORIES, parentOf, type LeafCategory } from './data/categories';
import type { FacilityName } from './data/facilities';
import { FIRST_NAMES, LAST_NAMES, LEARNER_NOTES, ORG_PREFIXES, STREETS } from './data/names';
import { COURSE_TITLES, PROVIDER_SUFFIX, SPACE_KINDS, SPACE_KIND_CYCLE, audiencesFor, requirementsFor } from './catalog';
import { DEMO_ACCOUNTS, GENERATED_EMAIL_DOMAIN } from './constants';
import { isRequestFeasible, openSlots, spaceSupportsOffering, working } from './feasibility';
import { haversineKm, jitter, type LngLat } from './geo';
import { Rng, spread } from './prng';
import {
  INFEASIBLE_REASONS,
  type GeneratorConfig,
  type InfeasibleReason,
  type PlanCourse,
  type PlanLearner,
  type PlanOffering,
  type PlanProvider,
  type PlanRequest,
  type PlanSlot,
  type PlanSpace,
  type PlanSpaceGiver,
  type PlanWindow,
  type RequestIntent,
  type SeedPlan,
} from './types';

/** Requests are placed within this distance of their area centre (README: ~1.5 km). */
const REQUEST_JITTER_KM = 1.5;
const SPACE_JITTER_KM = 1.2;
const MIN_BATCH = 8;
const MAX_BATCH = 30;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Midnight UTC on the first day of the month after `now`. */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function personName(rng: Rng): { first: string; last: string; full: string } {
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  return { first, last, full: `${first} ${last}` };
}

function phone(rng: Rng): string {
  return `+91 ${rng.pick(['98', '97', '96', '95', '93', '90', '88', '84', '77', '70'])}${rng.int(100, 999)} ${rng.int(10000, 99999)}`;
}

function slugEmail(local: string, n: number): string {
  const clean = local.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return `${clean}.${n}@${GENERATED_EMAIL_DOMAIN}`;
}

function window(dayOfWeek: number, start: number, end: number): PlanWindow {
  return { dayOfWeek, startTime: toHHmm(start), endTime: toHHmm(end) };
}

function windowLength(w: PlanWindow): number {
  return toMinutes(w.endTime) - toMinutes(w.startTime);
}

function sortWindows<T extends PlanWindow>(windows: T[]): T[] {
  return [...windows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime));
}

function ageBandFor(rng: Rng, audience: Audience): AgeBand {
  switch (audience) {
    case 'Children':
      return 'Under 13';
    case 'Teens':
      return '13-17';
    case 'Seniors':
      return '60+';
    case 'Adults':
      return rng.pick(['18-24', '25-40', '41-60'] as const);
  }
}

const AUDIENCE_MIX: { audience: Audience; weight: number }[] = [
  { audience: 'Adults', weight: 0.55 },
  { audience: 'Teens', weight: 0.25 },
  { audience: 'Children', weight: 0.12 },
  { audience: 'Seniors', weight: 0.08 },
];

/** Weekly slots: weekday evenings and/or weekend blocks, never overlapping, never before 09:00. */
function makeSlots(rng: Rng): PlanSlot[] {
  const slots: PlanSlot[] = [];
  const pattern = rng.weighted(['evenings', 'weekends', 'both'] as const, (p) => (p === 'both' ? 0.35 : p === 'evenings' ? 0.35 : 0.3));
  if (pattern !== 'weekends') {
    for (const day of rng.sample([1, 2, 3, 4, 5], rng.int(2, 5)).sort()) {
      const start = rng.step(16 * 60 + 30, 18 * 60, 30);
      const end = Math.min(22 * 60, start + rng.step(180, 240, 30));
      slots.push({ ...window(day, start, end), isBlocked: false });
    }
  }
  if (pattern !== 'evenings') {
    for (const day of rng.chance(0.6) ? [6, 0] : [rng.pick([6, 0])]) {
      if (rng.chance(0.5)) {
        slots.push({ ...window(day, 9 * 60, rng.step(17 * 60, 18 * 60, 30)), isBlocked: false });
      } else {
        slots.push({ ...window(day, 9 * 60, 13 * 60), isBlocked: false });
        slots.push({ ...window(day, 14 * 60, 18 * 60), isBlocked: false });
      }
    }
  }
  // Occasionally a blocked slot (maintenance or the owner's own event) on an unused weekday.
  const used = new Set(slots.map((s) => s.dayOfWeek));
  const free = [1, 2, 3, 4, 5].filter((d) => !used.has(d));
  if (free.length > 0 && rng.chance(0.15)) slots.push({ ...window(rng.pick(free), 18 * 60, 21 * 60), isBlocked: true });
  return sortWindows(slots);
}

const SPACE_RULES = [
  '',
  'No food inside the room. Please leave furniture as you found it.',
  'Footwear outside. Classes must end on time; the building closes 30 minutes after the last slot.',
  'Children under 13 need an adult at drop-off and pick-up.',
  'Equipment stays in the room. Report any damage to the caretaker.',
];

// ---------------------------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------------------------

function buildSpaceGivers(rng: Rng, config: GeneratorConfig, prefixes: string[]): PlanSpaceGiver[] {
  const total = Math.max(config.spaceGivers, Math.round(config.spaceGivers * config.spacesPerGiver));
  const perGiver = spread(total, config.spaceGivers);
  const eligible = AREAS.filter((a) => !(NO_SPACE_AREAS as readonly string[]).includes(a.name));
  const areaWeight = (a: AreaSeed) => ((SOUTH_PUNE as readonly string[]).includes(a.name) ? 2 : 1) * (0.5 + a.population / 250_000);
  const usedNames = new Set<string>();
  const givers: PlanSpaceGiver[] = [];
  let spaceIndex = 0;

  perGiver.forEach((count, g) => {
    const prefix = prefixes[g % prefixes.length]! + (g >= prefixes.length ? ` ${Math.floor(g / prefixes.length) + 1}` : '');
    const contact = personName(rng);
    const named = config.namedAccounts && g === 0;
    const homeArea = spaceIndex === 0 ? areaByName('Kothrud') : rng.weighted(eligible, areaWeight);
    const orgName = `${prefix} ${rng.pick(['Education Trust', 'Foundation', 'Community Trust', 'Shikshan Sanstha', 'Seva Sangh', 'Vidyalaya'])}`;
    const spaces: PlanSpace[] = [];
    for (let i = 0; i < count; i++, spaceIndex++) {
      const kind = SPACE_KINDS[SPACE_KIND_CYCLE[spaceIndex % SPACE_KIND_CYCLE.length]!];
      const area = spaceIndex === 0 ? areaByName('Kothrud') : rng.chance(0.6) ? homeArea : rng.weighted(eligible, areaWeight);
      let name = rng.pick(kind.names).replace('{p}', prefix);
      if (usedNames.has(name)) name = `${name}, ${area.name}`;
      for (let n = 2; usedNames.has(name); n++) name = `${name} ${n}`;
      usedNames.add(name);
      const seats = rng.int(kind.seats[0], kind.seats[1]);
      const free = rng.chance(0.25);
      spaces.push({
        name,
        description: kind.description,
        address: `${rng.int(1, 250)}, ${rng.pick(STREETS)}, ${area.name}, Pune ${area.pincode}`,
        areaName: area.name,
        location: jitter(rng, area.center, SPACE_JITTER_KM),
        seatCapacity: seats,
        facilities: kind.facilities(rng, seats),
        slots: makeSlots(rng),
        policy: {
          categories: kind.categories(rng),
          audiences: kind.audiences(rng),
          rentPerHour: free ? 0 : rng.step(100, 800, 50),
          approvalMode: rng.chance(0.7) ? 'auto' : 'manual',
          rules: rng.pick(SPACE_RULES),
        },
      });
    }
    givers.push({
      account: {
        email: named ? DEMO_ACCOUNTS.spaceGiver : slugEmail(`spaces.${prefix}`, g + 1),
        name: contact.full,
        role: 'SpaceGiver',
        named,
      },
      partner: {
        type: 'SpaceGiverOrg',
        name: orgName,
        contactPhone: phone(rng),
        about: `${orgName} opens its rooms to community classes outside its own hours.`,
      },
      spaces,
    });
  });
  return givers;
}

// ---------------------------------------------------------------------------------------------
// Courses and offerings
// ---------------------------------------------------------------------------------------------

/** Largest batch (MIN_BATCH..MAX_BATCH) that the space can host for this category, or 0. */
function maxBatchFor(space: PlanSpace, category: LeafCategory): number {
  const p = space.policy;
  if (p.categories.length > 0 && !p.categories.includes(category)) return 0;
  for (let b = Math.min(MAX_BATCH, space.seatCapacity); b >= MIN_BATCH; b--) {
    if (requirementsFor(category, b).every((r) => working(space, r.facility) >= r.minQuantity)) return b;
  }
  return 0;
}

function audienceOptions(space: PlanSpace, category: LeafCategory): Audience[] {
  const wanted = audiencesFor(category);
  return space.policy.audiences.length === 0 ? wanted : wanted.filter((a) => space.policy.audiences.includes(a));
}

function canHost(space: PlanSpace, category: LeafCategory): boolean {
  return maxBatchFor(space, category) > 0 && audienceOptions(space, category).length > 0 && openSlots(space).some((s) => windowLength(s) >= 60);
}

/** One offering window inside an open slot of the space, plus the session length. */
function windowInSlot(rng: Rng, space: PlanSpace, exceptDay?: number): { window: PlanWindow; sessionMinutes: number } | null {
  const slots = openSlots(space).filter((s) => windowLength(s) >= 60 && s.dayOfWeek !== exceptDay);
  if (slots.length === 0) return null;
  const slot = rng.pick(slots);
  const slotStart = toMinutes(slot.startTime);
  const slotLen = windowLength(slot);
  const sessionMinutes = rng.step(60, Math.min(180, slotLen), 30);
  const length = Math.min(slotLen, sessionMinutes + rng.step(0, 60, 30));
  const start = slotStart + rng.step(0, slotLen - length, 30);
  return { window: window(slot.dayOfWeek, start, start + length), sessionMinutes };
}

function buildOffering(
  rng: Rng,
  space: PlanSpace,
  spaceIndex: number,
  course: PlanCourse,
  courseBatch: number,
  startBase: Date,
  fixedSession?: number,
): PlanOffering | null {
  const audiences = audienceOptions(space, course.category);
  const first = windowInSlot(rng, space);
  if (!first || audiences.length === 0) return null;
  const sessionMinutes = Math.min(fixedSession ?? first.sessionMinutes, windowLength(first.window));
  const windows = [first.window];
  if (rng.chance(0.4)) {
    const second = windowInSlot(rng, space, first.window.dayOfWeek);
    if (second && windowLength(second.window) >= sessionMinutes) windows.push(second.window);
  }
  const rent = space.policy.rentPerHour;
  const maxRentPerHour = rent === 0 ? (rng.chance(0.5) ? null : rng.step(0, 300, 50)) : rng.chance(0.2) ? null : rent + rng.step(0, 300, 50);
  return {
    audience: rng.pick(audiences),
    batchSize: rng.int(MIN_BATCH, courseBatch),
    sessionMinutes,
    durationWeeks: rng.int(4, 16),
    startDate: new Date(startBase.getTime() + rng.int(0, 14) * 86_400_000),
    targetAreaName: rng.chance(0.8) ? space.areaName : null,
    windows: sortWindows(windows),
    maxRentPerHour,
    feePerMonth: rng.chance(0.15) ? 0 : rng.step(300, 1500, 50),
    anchorSpaceIndex: spaceIndex,
  };
}

const FAMILIES = Object.keys(PROVIDER_SUFFIX);

function buildProviders(rng: Rng, config: GeneratorConfig, spaces: PlanSpace[], prefixes: string[], startBase: Date): PlanProvider[] {
  const offered = LEAF_CATEGORIES.filter((c) => !UNOFFERED_CATEGORIES.includes(c));
  const hosts = new Map<LeafCategory, number[]>();
  for (const c of offered) hosts.set(c, spaces.flatMap((s, i) => (canHost(s, c) ? [i] : [])));
  const hostable = offered.filter((c) => hosts.get(c)!.length > 0);
  if (hostable.length === 0) throw new Error('Seed generator: no space can host any course; increase spaceGivers or spacesPerGiver.');

  const totalCourses = Math.max(config.providers, Math.round(config.providers * config.coursesPerProvider));
  const coursesPer = spread(totalCourses, config.providers);
  const totalOfferings = Math.max(totalCourses, Math.round(totalCourses * config.offeringsPerCourse));
  const offeringsPer = spread(totalOfferings, totalCourses);
  const familyOrder = rng.shuffle(FAMILIES.filter((f) => f !== 'Technology'));
  let courseCounter = 0;

  return coursesPer.map((courseCount, p) => {
    const named = config.namedAccounts && p === 0;
    const family = p === 0 ? 'Technology' : familyOrder[(p - 1) % familyOrder.length]!;
    const tutor = !named && rng.chance(0.35);
    const person = personName(rng);
    const prefix = prefixes[(p + 7) % prefixes.length]!;
    const partnerName = tutor ? person.full : `${prefix} ${rng.pick(PROVIDER_SUFFIX[family]!)}`;
    const familyCats = hostable.filter((c) => parentOf(c) === family);
    const usedTitles = new Set<string>();
    const courses: PlanCourse[] = [];

    for (let c = 0; c < courseCount; c++, courseCounter++) {
      const pool = familyCats.length > 0 ? familyCats : hostable;
      const category = rng.weighted(pool, (cat) => CATEGORY_POPULARITY[cat]);
      const hostList = hosts.get(category)!;
      // The demo provider's first course is anchored at the Kothrud lab (space 0) when it can host it.
      const anchorIndex = named && c === 0 && hostList.includes(0) ? 0 : rng.pick(hostList);
      const anchor = spaces[anchorIndex]!;
      const courseBatch = rng.int(MIN_BATCH, maxBatchFor(anchor, category));
      const titles = COURSE_TITLES[category].filter((t) => !usedTitles.has(t));
      const title = titles.length > 0 ? rng.pick(titles) : `${rng.pick(COURSE_TITLES[category])} (Batch ${c + 1})`;
      usedTitles.add(title);
      const course: PlanCourse = {
        title,
        description: `${title}: a practical ${category.toLowerCase()} course for beginners, taught in small batches.`,
        category,
        requirements: requirementsFor(category, courseBatch),
        offerings: [],
      };
      const count = offeringsPer[courseCounter] ?? 1;
      for (let o = 0; o < count; o++) {
        // Later offerings of the same course may run at another venue that meets the same requirements.
        const candidates = hostList.filter((i) => maxBatchFor(spaces[i]!, category) >= courseBatch);
        const spaceIdx = o === 0 ? anchorIndex : rng.pick(candidates.length > 0 ? candidates : [anchorIndex]);
        const offering = buildOffering(rng, spaces[spaceIdx]!, spaceIdx, course, courseBatch, startBase);
        if (!offering) continue;
        if (!spaceSupportsOffering(spaces[spaceIdx]!, course, offering)) {
          throw new Error(`Seed generator bug: offering of "${title}" does not fit its anchor space "${spaces[spaceIdx]!.name}".`);
        }
        course.offerings.push(offering);
      }
      courses.push(course);
    }

    return {
      account: {
        email: named ? DEMO_ACCOUNTS.provider : slugEmail(tutor ? person.full : `provider.${prefix}`, p + 1),
        name: person.full,
        role: 'CourseProvider' as const,
        named,
      },
      partner: {
        type: tutor ? ('IndividualTutor' as const) : ('ProviderOrg' as const),
        name: partnerName,
        contactPhone: phone(rng),
        about: tutor ? `Independent ${family.toLowerCase()} tutor based in Pune.` : `${partnerName} runs community ${family.toLowerCase()} classes across Pune.`,
      },
      courses,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Learners and requests
// ---------------------------------------------------------------------------------------------

interface OfferingRef {
  course: PlanCourse;
  offering: PlanOffering;
  anchor: PlanSpace;
}

interface RequestContext {
  rng: Rng;
  plan: SeedPlan;
  spaces: PlanSpace[];
  offerings: OfferingRef[];
  startBase: Date;
}

function requestBase(ctx: RequestContext, area: AreaSeed, audience: Audience): Omit<PlanRequest, 'category' | 'intent' | 'maxDistanceKm' | 'windows'> {
  return {
    areaName: area.name,
    location: jitter(ctx.rng, area.center, REQUEST_JITTER_KM),
    audience,
    startMonth: monthKey(ctx.startBase),
    durationMonths: ctx.rng.int(1, 6),
    requiredFacilities: [],
    budgetPerMonth: ctx.rng.chance(0.4) ? null : ctx.rng.step(500, 2000, 100),
    notes: ctx.rng.pick(LEARNER_NOTES),
  };
}

function minSpaceDistance(spaces: PlanSpace[], point: LngLat): number {
  return spaces.reduce((min, s) => Math.min(min, haversineKm(point, s.location)), Infinity);
}

function offeredCategoriesFor(ctx: RequestContext, audience: Audience): LeafCategory[] {
  const cats = ctx.offerings.filter((o) => o.offering.audience === audience).map((o) => o.course.category);
  return [...new Set(cats.length > 0 ? cats : ctx.offerings.map((o) => o.course.category))];
}

function buildFeasible(ctx: RequestContext, home: AreaSeed, audience: Audience, avoid: Set<LeafCategory>, preferred?: OfferingRef): PlanRequest | null {
  const { rng } = ctx;
  const matching = ctx.offerings.filter((o) => o.offering.audience === audience);
  if (matching.length === 0) return null;
  const fresh = matching.filter((o) => !avoid.has(o.course.category));
  const pool = fresh.length > 0 ? fresh : matching;
  const near = pool.filter((o) => haversineKm(home.center, o.anchor.location) <= 6);
  const ref = preferred ?? rng.pick(near.length > 0 ? near : pool);
  const area = haversineKm(home.center, ref.anchor.location) <= 6 ? home : areaByName(ref.anchor.areaName);
  const base = requestBase(ctx, area, audience);
  const distance = haversineKm(base.location, ref.anchor.location);
  const maxDistanceKm = Math.min(8, Math.max(2, Math.ceil(distance + rng.range(0.3, 2))));
  if (distance > maxDistanceKm) return null;

  // Windows: flexible, or the offering window that fits the anchor space, widened a little.
  let windows: PlanWindow[] = [];
  if (!rng.chance(0.25)) {
    const fitting = ref.offering.windows.filter((w) => openSlots(ref.anchor).some((s) => s.dayOfWeek === w.dayOfWeek && toMinutes(s.startTime) <= toMinutes(w.startTime) && toMinutes(s.endTime) >= toMinutes(w.endTime)));
    const w = rng.pick(fitting.length > 0 ? fitting : ref.offering.windows);
    const start = Math.max(6 * 60, toMinutes(w.startTime) - rng.step(0, 60, 30));
    const end = Math.min(22 * 60, toMinutes(w.endTime) + rng.step(0, 60, 30));
    windows = [window(w.dayOfWeek, start, end)];
  }
  const fee = ref.offering.feePerMonth ?? 0;
  const facilityOptions = ref.anchor.facilities.filter((f) => f.workingQuantity >= 1 && ['Wheelchair access', 'Air conditioning', 'Wi-Fi'].includes(f.facility));
  const requiredFacilities: FacilityName[] = facilityOptions.length > 0 && rng.chance(0.15) ? [rng.pick(facilityOptions).facility] : [];
  return {
    ...base,
    category: ref.course.category,
    maxDistanceKm,
    windows,
    requiredFacilities,
    startMonth: monthKey(ref.offering.startDate),
    durationMonths: Math.max(1, Math.round(ref.offering.durationWeeks / 4.33)),
    budgetPerMonth: rng.chance(0.3) ? null : fee + rng.step(0, 800, 100),
    intent: 'feasible',
  };
}

function buildFar(ctx: RequestContext, audience: Audience): PlanRequest | null {
  const { rng } = ctx;
  // Try a few points in the outer areas and keep the one farthest from every space.
  let best: { area: AreaSeed; base: ReturnType<typeof requestBase>; min: number } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const area = areaByName(rng.pick(NO_SPACE_AREAS));
    const base = requestBase(ctx, area, audience);
    const min = minSpaceDistance(ctx.spaces, base.location);
    if (!best || min > best.min) best = { area, base, min };
  }
  if (!best || best.min < 2.6) return null;
  const maxDistanceKm = Math.min(8, Math.max(2, Math.floor(best.min - 0.5)));
  if (maxDistanceKm >= best.min) return null;
  return {
    ...best.base,
    category: rng.pick(offeredCategoriesFor(ctx, audience)),
    maxDistanceKm,
    windows: rng.chance(0.5) ? [] : [window(rng.pick([6, 0]), 10 * 60, 13 * 60)],
    intent: 'far',
  };
}

function buildCategory(ctx: RequestContext, home: AreaSeed, audience: Audience): PlanRequest {
  const { rng } = ctx;
  return {
    ...requestBase(ctx, home, audience),
    category: rng.pick(UNOFFERED_CATEGORIES),
    maxDistanceKm: rng.int(2, 8),
    windows: rng.chance(0.5) ? [] : [window(rng.pick([1, 3, 5]), 18 * 60, 20 * 60)],
    intent: 'category',
  };
}

function buildBudget(ctx: RequestContext, audience: Audience): PlanRequest | null {
  const { rng } = ctx;
  const byCategory = new Map<LeafCategory, number>();
  for (const o of ctx.offerings) {
    const fee = o.offering.feePerMonth ?? 0;
    byCategory.set(o.course.category, Math.min(byCategory.get(o.course.category) ?? Infinity, fee));
  }
  const paid = ctx.offerings.filter((o) => o.offering.audience === audience && (byCategory.get(o.course.category) ?? 0) >= 300);
  if (paid.length === 0) return null;
  const ref = rng.pick(paid);
  const minFee = byCategory.get(ref.course.category)!;
  const area = areaByName(ref.anchor.areaName);
  return {
    ...requestBase(ctx, area, audience),
    category: ref.course.category,
    maxDistanceKm: rng.int(4, 8),
    windows: [],
    budgetPerMonth: Math.floor((minFee * 0.5) / 50) * 50,
    intent: 'budget',
  };
}

const RARE_FACILITIES: readonly FacilityName[] = ['Air conditioning', 'Wheelchair access', 'Musical instruments', 'Mirrors', 'Dance floor', 'Projector', 'Wi-Fi'];

function buildFacility(ctx: RequestContext, home: AreaSeed, audience: Audience): PlanRequest | null {
  const { rng } = ctx;
  for (const area of [home, ...rng.sample(AREAS, 6)]) {
    const base = requestBase(ctx, area, audience);
    const maxDistanceKm = rng.int(2, 6);
    const nearby = ctx.spaces.filter((s) => haversineKm(base.location, s.location) <= maxDistanceKm);
    if (nearby.length === 0) continue;
    const missing = RARE_FACILITIES.filter((f) => nearby.every((s) => working(s, f) < 1));
    if (missing.length === 0) continue;
    return {
      ...base,
      category: rng.pick(offeredCategoriesFor(ctx, audience)),
      maxDistanceKm,
      windows: [],
      requiredFacilities: [rng.pick(missing)],
      intent: 'facility',
    };
  }
  return null;
}

function buildTime(ctx: RequestContext, home: AreaSeed, audience: Audience): PlanRequest {
  const { rng } = ctx;
  // Early mornings before work: no slot or offering window starts before 09:00.
  const days = rng.sample([1, 2, 3, 4, 5], 2).sort();
  return {
    ...requestBase(ctx, home, audience),
    category: rng.pick(offeredCategoriesFor(ctx, audience)),
    maxDistanceKm: rng.int(3, 8),
    windows: days.map((d) => window(d, 6 * 60, 7 * 60 + 30)),
    intent: 'time',
  };
}

function buildInfeasible(ctx: RequestContext, reason: InfeasibleReason, home: AreaSeed, audience: Audience): PlanRequest {
  const built =
    reason === 'far' ? buildFar(ctx, audience)
    : reason === 'category' ? buildCategory(ctx, home, audience)
    : reason === 'budget' ? buildBudget(ctx, audience)
    : reason === 'facility' ? buildFacility(ctx, home, audience)
    : buildTime(ctx, home, audience);
  return built ?? buildTime(ctx, home, audience);
}

function buildLearners(rng: Rng, config: GeneratorConfig, plan: SeedPlan, startBase: Date): PlanLearner[] {
  const spaces = plan.spaceGivers.flatMap((g) => g.spaces);
  const offerings: OfferingRef[] = plan.providers.flatMap((p) =>
    p.courses.flatMap((course) => course.offerings.map((offering) => ({ course, offering, anchor: spaces[offering.anchorSpaceIndex]! }))),
  );
  const ctx: RequestContext = { rng, plan, spaces, offerings, startBase };

  const totalRequests = Math.max(config.learners, Math.round(config.learners * config.requestsPerLearner));
  const nFeasible = offerings.length === 0 ? 0 : Math.round(totalRequests * Math.min(1, Math.max(0, config.feasibleRatio)));
  const intents: RequestIntent[] = rng.shuffle([
    ...Array.from({ length: nFeasible }, () => 'feasible' as const),
    ...Array.from({ length: totalRequests - nFeasible }, (_, i) => INFEASIBLE_REASONS[i % INFEASIBLE_REASONS.length]!),
  ]);
  // Bucket per learner, feasible first, so a learner's later feasible requests share the first one's audience.
  const sizes = spread(totalRequests, config.learners);
  let cursor = 0;
  const buckets = sizes.map((n) => {
    const b = intents.slice(cursor, cursor + n);
    cursor += n;
    return b.sort((a, b2) => (a === 'feasible' ? 0 : 1) - (b2 === 'feasible' ? 0 : 1));
  });
  // The named demo learner (Kothrud) gets a feasible first request when there is one to give.
  if (config.namedAccounts && buckets[0] && buckets[0][0] !== 'feasible') {
    const donor = buckets.findIndex((b) => b[0] === 'feasible' && b.length === buckets[0]!.length);
    if (donor > 0) [buckets[0], buckets[donor]] = [buckets[donor]!, buckets[0]!];
  }

  const homeWeight = (a: AreaSeed) => a.population / 100_000;
  return buckets.map((bucket, i) => {
    const named = config.namedAccounts && i === 0;
    const person = personName(rng);
    const first = bucket[0] ?? 'time';
    let home: AreaSeed = named ? areaByName('Kothrud') : rng.weighted(AREAS, homeWeight);
    let audience: Audience = rng.weighted(AUDIENCE_MIX, (m) => m.weight).audience;
    let preferred: OfferingRef | undefined;

    if (first === 'feasible') {
      const candidates = named ? offerings.filter((o) => o.anchor.areaName === 'Kothrud') : [];
      const ref = candidates[0] ?? rng.pick(offerings);
      preferred = ref;
      audience = ref.offering.audience;
      if (!named) home = areaByName(ref.anchor.areaName);
    } else if (first === 'far') {
      home = areaByName(rng.pick(NO_SPACE_AREAS));
    }

    const ageBand = named && audience === 'Adults' ? '25-40' : ageBandFor(rng, audience);
    const requests: PlanRequest[] = [];
    const used = new Set<LeafCategory>();
    bucket.forEach((intent, r) => {
      let req: PlanRequest | null;
      if (intent === 'feasible') {
        req = buildFeasible(ctx, home, audience, used, r === 0 ? preferred : undefined);
        if (!req) throw new Error('Seed generator bug: could not build a feasible request.');
      } else {
        req = buildInfeasible(ctx, intent, home, audience);
      }
      if (req.audience !== audienceForAgeBand(ageBand)) throw new Error('Seed generator bug: request audience does not match the learner.');
      used.add(req.category);
      requests.push(req);
    });

    return {
      account: {
        email: named ? DEMO_ACCOUNTS.learner : slugEmail(`${person.first}.${person.last}`, i + 1),
        name: person.full,
        role: 'Learner' as const,
        named,
      },
      ageBand,
      contactPhone: phone(rng),
      areaName: home.name,
      accessibilityNeeds: requests.some((q) => q.requiredFacilities.includes('Wheelchair access')) ? ['Wheelchair user'] : [],
      requests,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Builds a reproducible dataset. Pure: no I/O. `now` anchors start dates ("next month"),
 * so pass a fixed date when comparing two plans.
 */
export function generatePlan(config: GeneratorConfig, now: Date = new Date()): SeedPlan {
  const rng = new Rng(config.seed);
  const startBase = nextMonthStart(now);
  const prefixes = rng.shuffle(ORG_PREFIXES);
  const plan: SeedPlan = { spaceGivers: [], providers: [], learners: [] };
  plan.spaceGivers = buildSpaceGivers(rng, config, prefixes);
  const spaces = plan.spaceGivers.flatMap((g) => g.spaces);
  plan.providers = buildProviders(rng, config, spaces, prefixes, startBase);
  plan.learners = buildLearners(rng, config, plan, startBase);

  // Every request must be (in)feasible exactly as intended.
  for (const learner of plan.learners) {
    for (const req of learner.requests) {
      const feasible = isRequestFeasible(plan, req);
      if (feasible !== (req.intent === 'feasible')) {
        throw new Error(`Seed generator bug: a "${req.intent}" request for ${req.category} in ${req.areaName} is ${feasible ? 'feasible' : 'infeasible'}.`);
      }
    }
  }
  return plan;
}

/** Counts of requests by intent. Infeasible reasons may differ from the round-robin when a reason could not be built (fallback: time). */
export function intentMix(plan: SeedPlan): Record<RequestIntent, number> & { total: number } {
  const mix = { feasible: 0, far: 0, category: 0, budget: 0, facility: 0, time: 0, total: 0 };
  for (const l of plan.learners) for (const r of l.requests) {
    mix[r.intent]++;
    mix.total++;
  }
  return mix;
}
