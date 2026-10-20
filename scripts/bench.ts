// Engine benchmark (README 3.17): a seeded synthetic Pune snapshot of ~500 spaces, ~40 areas,
// ~12 categories, ~150 offerings and 2,000 requests. Prints phase timings and metrics against
// the greedy baseline, and writes bench-results/latest.json.
// Run: npx tsx scripts/bench.ts [--seed 42] [--requests 2000]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipelineDetailed } from '../src/engine/pipeline';
import { DEFAULT_SETTINGS } from '../src/engine/settings';
import type {
  Audience,
  DayOfWeek,
  EngineArea,
  EngineCategory,
  EngineOffering,
  EngineRequest,
  EngineSnapshot,
  EngineSpace,
  GeoPoint,
  IncomeGroup,
  RunMetrics,
  TimeWindow,
} from '../src/engine/types';
import { haversineKm } from '../src/engine/util/geo';
import { mulberry32 } from '../src/engine/util/prng';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

const SEED = arg('seed', 42);
const N_SPACES = arg('spaces', 500);
const N_AREAS = arg('areas', 40);
const N_OFFERINGS = arg('offerings', 150);
const N_REQUESTS = arg('requests', 2000);

const BOX = { lngMin: 73.7, lngMax: 74.0, latMin: 18.42, latMax: 18.65 };
const rand = mulberry32(SEED);
const uniform = (a: number, b: number): number => a + (b - a) * rand();
const int = (a: number, b: number): number => Math.floor(uniform(a, b + 1));
function pick<T>(xs: readonly T[]): T {
  const x = xs[Math.floor(rand() * xs.length)];
  if (x === undefined) throw new Error('pick from empty list');
  return x;
}
function gauss(): number {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const randomPoint = (): GeoPoint => ({ lng: uniform(BOX.lngMin, BOX.lngMax), lat: uniform(BOX.latMin, BOX.latMax) });
function near(p: GeoPoint, km: number): GeoPoint {
  return {
    lng: Math.min(BOX.lngMax, Math.max(BOX.lngMin, p.lng + (gauss() * km) / 105.5)),
    lat: Math.min(BOX.latMax, Math.max(BOX.latMin, p.lat + (gauss() * km) / 111.2)),
  };
}

function generate(): EngineSnapshot {
  const areas: EngineArea[] = Array.from({ length: N_AREAS }, (_, i) => {
    const incomeGroup: IncomeGroup = pick(['Low', 'Medium', 'High']);
    return {
      id: `area-${i}`,
      name: `Area ${i}`,
      center: randomPoint(),
      population: int(40_000, 300_000),
      studentCount: int(5_000, 60_000),
      literacyRate: uniform(70, 98),
      incomeScore: incomeGroup === 'Low' ? uniform(10, 40) : incomeGroup === 'Medium' ? uniform(35, 70) : uniform(65, 95),
      incomeGroup,
    };
  });
  const nearestArea = (p: GeoPoint): string => {
    let best = areas[0]?.id ?? '';
    let bestD = Infinity;
    for (const a of areas) {
      const d = haversineKm(p, a.center);
      if (d < bestD) {
        bestD = d;
        best = a.id;
      }
    }
    return best;
  };

  const parents = ['Technology', 'Arts', 'Academics'];
  const children: [string, number][] = [
    ['Coding', 0], ['Robotics', 0], ['Data Skills', 0],
    ['Music', 1], ['Painting', 1], ['Dance', 1],
    ['Maths', 2], ['English', 2], ['Science', 2],
  ];
  const categories: EngineCategory[] = [
    ...parents.map((name, i) => ({ id: `cat-p${i}`, name, parentId: null })),
    ...children.map(([name, p], i) => ({ id: `cat-${i}`, name, parentId: `cat-p${p}` })),
  ];
  const leafIds = children.map((_, i) => `cat-${i}`);
  const facilityTypes = ['Computers', 'Projector', 'Science lab', 'Wheelchair access', 'Whiteboard'].map((name, i) => ({ id: `fac-${i}`, name }));
  const audiences: Audience[] = ['Children', 'Teens', 'Teens', 'Adults', 'Seniors'];
  const slotTemplates: TimeWindow[] = [
    { dayOfWeek: 6, start: 9 * 60, end: 13 * 60 },
    { dayOfWeek: 6, start: 14 * 60, end: 18 * 60 },
    { dayOfWeek: 0, start: 9 * 60, end: 13 * 60 },
    { dayOfWeek: 0, start: 14 * 60, end: 18 * 60 },
    { dayOfWeek: 3, start: 17 * 60, end: 20 * 60 },
    { dayOfWeek: 5, start: 17 * 60, end: 20 * 60 },
  ];

  const spaces: EngineSpace[] = Array.from({ length: N_SPACES }, (_, i) => {
    const location = randomPoint();
    const nSlots = int(2, 4);
    const templates = [...slotTemplates].sort(() => rand() - 0.5).slice(0, nSlots);
    const facilities = facilityTypes
      .filter(() => rand() < 0.5)
      .map((f) => {
        const quantity = f.id === 'fac-0' ? int(5, 40) : int(1, 3);
        return { facilityTypeId: f.id, quantity, workingQuantity: Math.max(0, quantity - (rand() < 0.2 ? int(1, 3) : 0)) };
      });
    const slots = templates.map((t, j) => ({ ...t, slotId: `sp-${i}-slot-${j}`, isBlocked: rand() < 0.05 }));
    const firstSlot = slots[0];
    const bookings: TimeWindow[] =
      firstSlot && rand() < 0.15 ? [{ dayOfWeek: firstSlot.dayOfWeek, start: firstSlot.start, end: firstSlot.start + 60 }] : [];
    return {
      id: `space-${i}`,
      name: `Space ${i}`,
      ownerUserId: `owner-${i % 120}`,
      areaId: nearestArea(location),
      location,
      isActive: rand() < 0.95,
      seatCapacity: int(12, 60),
      facilities,
      slots,
      policy: {
        allowedCategoryIds: rand() < 0.2 ? leafIds.filter(() => rand() < 0.5) : [],
        allowedAudiences: rand() < 0.15 ? (['Children', 'Teens'] as Audience[]) : [],
        rentPerHour: rand() < 0.15 ? 0 : int(2, 16) * 50,
        approvalMode: rand() < 0.5 ? 'auto' : 'manual',
      },
      bookings,
    };
  });

  const offerings: EngineOffering[] = Array.from({ length: N_OFFERINGS }, (_, i) => {
    const categoryId = pick(leafIds);
    const sessionMinutes = pick([60, 90, 120]);
    const windows: TimeWindow[] = rand() < 0.3 ? [] : [pick(slotTemplates)].map((w) => ({ ...w }));
    const requirements = categoryId === 'cat-0' || categoryId === 'cat-2' ? [{ facilityTypeId: 'fac-0', minQuantity: int(5, 15) }] : rand() < 0.3 ? [{ facilityTypeId: pick(['fac-1', 'fac-4']), minQuantity: 1 }] : [];
    const o: EngineOffering = {
      id: `off-${String(i).padStart(3, '0')}`,
      courseId: `course-${i}`,
      providerUserId: `provider-${i % 60}`,
      title: `Offering ${i}`,
      categoryId,
      audience: pick(audiences),
      batchSize: int(8, 20),
      sessionMinutes,
      durationWeeks: int(4, 12),
      targetAreaId: rand() < 0.5 ? pick(areas).id : null,
      windows,
      maxRentPerHour: rand() < 0.2 ? null : int(4, 18) * 50,
      feePerMonth: rand() < 0.3 ? null : int(2, 15) * 100,
      requirements,
    };
    return o;
  });
  // A few offerings keep an existing allocation.
  for (const o of offerings.slice(0, 10)) {
    const sp = pick(spaces.filter((s) => s.isActive && s.slots.some((sl) => !sl.isBlocked)));
    const slot = sp.slots.find((sl) => !sl.isBlocked);
    if (!slot) continue;
    const start = slot.end - o.sessionMinutes;
    const session = { dayOfWeek: slot.dayOfWeek as DayOfWeek, start, end: slot.end };
    if (sp.bookings.some((b) => b.dayOfWeek === session.dayOfWeek && b.end > session.start && b.start < session.end)) continue;
    sp.bookings.push(session);
    o.fixed = { allocationId: `alloc-${o.id}`, spaceId: sp.id, session, seatsTaken: int(0, Math.floor(o.batchSize / 2)) };
  }

  const hotspots = areas.filter(() => rand() < 0.5);
  const requests: EngineRequest[] = Array.from({ length: N_REQUESTS }, (_, i) => {
    const area = pick(hotspots.length > 0 ? hotspots : areas);
    const location = near(area.center, 1.5);
    return {
      id: `req-${String(i).padStart(4, '0')}`,
      learnerUserId: `learner-${i}`,
      categoryId: pick(leafIds),
      areaId: nearestArea(location),
      location,
      audience: pick(audiences),
      maxDistanceKm: int(3, 8),
      windows: rand() < 0.5 ? [] : [pick(slotTemplates)].map((w) => ({ ...w })),
      requiredFacilityTypeIds: rand() < 0.05 ? ['fac-3'] : [],
      budgetPerMonth: rand() < 0.4 ? int(3, 15) * 100 : null,
      createdAt: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(),
    };
  });

  const demandBaseline = areas.flatMap((a) => (rand() < 0.3 ? [{ areaId: a.id, categoryId: pick(leafIds), baseline: int(5, 30) }] : []));
  return { now: '2026-10-16T08:00:00.000Z', areas, categories, facilityTypes, spaces, offerings, requests, demandBaseline };
}

const tGen = performance.now();
const snapshot = generate();
const genMs = performance.now() - tGen;
const settings = { ...DEFAULT_SETTINGS, seed: SEED };

const { result, timings } = runPipelineDetailed(snapshot, settings);

const row = (label: string, pick: (m: RunMetrics) => number, digits = 3): string => {
  const a = pick(result.metrics);
  const b = pick(result.baselineMetrics);
  return `| ${label.padEnd(22)} | ${a.toFixed(digits).padStart(10)} | ${b.toFixed(digits).padStart(10)} | ${(a - b >= 0 ? '+' : '') + (a - b).toFixed(digits)} |`;
};

console.log(`\nEduSpace engine benchmark (seed ${SEED})`);
console.log(
  `Snapshot: ${snapshot.spaces.length} spaces, ${snapshot.areas.length} areas, ${snapshot.categories.length} categories, ` +
    `${snapshot.offerings.length} offerings (${snapshot.offerings.filter((o) => o.fixed).length} fixed), ${snapshot.requests.length} requests ` +
    `(generated in ${genMs.toFixed(0)} ms)\n`,
);
console.log('| Phase                  |    ms |');
console.log('|------------------------|-------|');
for (const [phase, ms] of Object.entries(timings)) console.log(`| ${phase.padEnd(22)} | ${ms.toFixed(1).padStart(5)} |`);
console.log(`| ${'TOTAL (pipeline)'.padEnd(22)} | ${result.metrics.runTimeMs.toFixed(1).padStart(5)} |`);
console.log(`\nk = ${result.k}, silhouette = ${result.silhouette}, cohorts = ${result.cohorts.length}\n`);
console.log('| Metric                 |  Optimised |   Baseline | Delta |');
console.log('|------------------------|------------|------------|-------|');
console.log(row('allocations', (m) => m.allocations, 0));
console.log(row('assigned (seats)', (m) => m.assigned, 0));
console.log(row('waitlisted', (m) => m.waitlisted, 0));
console.log(row('unmatched', (m) => m.unmatched, 0));
console.log(row('coverage rate', (m) => m.coverageRate));
console.log(row('avg distance km', (m) => m.avgDistanceKm));
console.log(row('seat utilisation', (m) => m.seatUtilisation));
console.log(row('space util. hours', (m) => m.spaceUtilisationHours, 1));
console.log(row('avg score', (m) => m.avgScore));
console.log(row('optimisation score', (m) => m.optimisationScore));

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench-results');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'latest.json'),
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      seed: SEED,
      sizes: {
        spaces: snapshot.spaces.length,
        areas: snapshot.areas.length,
        categories: snapshot.categories.length,
        offerings: snapshot.offerings.length,
        requests: snapshot.requests.length,
      },
      timingsMs: { ...timings, total: result.metrics.runTimeMs },
      k: result.k,
      silhouette: result.silhouette,
      cohorts: result.cohorts.length,
      metrics: result.metrics,
      baselineMetrics: result.baselineMetrics,
    },
    null,
    2,
  ),
);
console.log(`\nWrote ${join('bench-results', 'latest.json')}`);
