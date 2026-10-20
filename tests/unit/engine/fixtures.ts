// Hand-built fixtures for engine tests: "weekend coding classes in South Pune".
import { DEFAULT_SETTINGS } from '@/engine/settings';
import type {
  EngineArea,
  EngineOffering,
  EngineRequest,
  EngineSettings,
  EngineSnapshot,
  EngineSpace,
  TimeWindow,
} from '@/engine/types';

export const SAT = 6 as const;
export const SUN = 0 as const;

export function hm(h: number, m = 0): number {
  return h * 60 + m;
}

export function win(dayOfWeek: TimeWindow['dayOfWeek'], start: number, end: number): TimeWindow {
  return { dayOfWeek, start, end };
}

export function settings(overrides: Partial<EngineSettings> = {}): EngineSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

export const AREAS: EngineArea[] = [
  { id: 'katraj', name: 'Katraj', center: { lng: 73.857, lat: 18.452 }, population: 210000, studentCount: 42000, literacyRate: 84, incomeScore: 38, incomeGroup: 'Low' },
  { id: 'bibwewadi', name: 'Bibwewadi', center: { lng: 73.866, lat: 18.478 }, population: 160000, studentCount: 30000, literacyRate: 89, incomeScore: 55, incomeGroup: 'Medium' },
  { id: 'sinhagad', name: 'Sinhagad Road', center: { lng: 73.826, lat: 18.476 }, population: 190000, studentCount: 35000, literacyRate: 91, incomeScore: 70, incomeGroup: 'High' },
];

export function space(overrides: Partial<EngineSpace> & { id: string }): EngineSpace {
  return {
    name: overrides.id,
    ownerUserId: 'owner-1',
    areaId: 'katraj',
    location: { lng: 73.857, lat: 18.452 },
    isActive: true,
    seatCapacity: 30,
    facilities: [],
    slots: [{ slotId: `${overrides.id}-sat`, dayOfWeek: SAT, start: hm(9), end: hm(13), isBlocked: false }],
    policy: { allowedCategoryIds: [], allowedAudiences: [], rentPerHour: 300, approvalMode: 'auto' },
    bookings: [],
    ...overrides,
  };
}

export function offering(overrides: Partial<EngineOffering> & { id: string }): EngineOffering {
  return {
    courseId: `course-${overrides.id}`,
    providerUserId: 'provider-1',
    title: overrides.id,
    categoryId: 'coding',
    audience: 'Teens',
    batchSize: 12,
    sessionMinutes: 120,
    durationWeeks: 8,
    targetAreaId: null,
    windows: [win(SAT, hm(10), hm(12))],
    maxRentPerHour: 450,
    feePerMonth: 500,
    requirements: [{ facilityTypeId: 'computer', minQuantity: 12 }],
    ...overrides,
  };
}

let reqCounter = 0;
export function request(overrides: Partial<EngineRequest> & { id?: string }): EngineRequest {
  reqCounter++;
  return {
    id: overrides.id ?? `r${reqCounter}`,
    learnerUserId: `learner-${overrides.id ?? reqCounter}`,
    categoryId: 'coding',
    areaId: 'katraj',
    location: { lng: 73.857, lat: 18.452 },
    audience: 'Teens',
    maxDistanceKm: 6,
    windows: [],
    requiredFacilityTypeIds: [],
    budgetPerMonth: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

export function baseSnapshot(overrides: Partial<EngineSnapshot> = {}): EngineSnapshot {
  return {
    now: '2026-10-16T08:00:00.000Z',
    areas: AREAS,
    categories: [
      { id: 'tech', name: 'Technology', parentId: null },
      { id: 'coding', name: 'Coding', parentId: 'tech' },
      { id: 'robotics', name: 'Robotics', parentId: 'tech' },
      { id: 'arts', name: 'Arts', parentId: null },
      { id: 'music', name: 'Music', parentId: 'arts' },
    ],
    facilityTypes: [
      { id: 'computer', name: 'Computers' },
      { id: 'projector', name: 'Projector' },
      { id: 'wheelchair', name: 'Wheelchair access' },
    ],
    spaces: [],
    offerings: [],
    requests: [],
    demandBaseline: [],
    ...overrides,
  };
}

/** Deterministic jitter around a point, roughly within `km` kilometres. */
export function around(p: { lng: number; lat: number }, i: number, km = 1.2): { lng: number; lat: number } {
  const angle = (i * 137.508 * Math.PI) / 180;
  const r = (km * ((i % 7) + 1)) / 7;
  return { lng: p.lng + (r / 105.5) * Math.cos(angle), lat: p.lat + (r / 111.2) * Math.sin(angle) };
}

/**
 * South Pune weekend scenario: 3 areas, 4 spaces (one inactive), 3 offerings, 30 requests.
 * 23 coding Teens (22 coding seats -> 1 waitlist), 1 coding Adult (no audience match),
 * 4 music Children, 2 robotics Teens (no robotics offering).
 */
export function southPuneSnapshot(): EngineSnapshot {
  const katraj = AREAS[0]!.center;
  const bibwewadi = AREAS[1]!.center;
  const sinhagad = AREAS[2]!.center;
  const spaces: EngineSpace[] = [
    space({
      id: 's-katraj-hall',
      name: 'Katraj Community Hall',
      areaId: 'katraj',
      location: { lng: 73.8575, lat: 18.4535 },
      seatCapacity: 30,
      facilities: [
        { facilityTypeId: 'computer', quantity: 26, workingQuantity: 25 },
        { facilityTypeId: 'projector', quantity: 1, workingQuantity: 1 },
      ],
      slots: [
        { slotId: 'kh-sat', dayOfWeek: SAT, start: hm(9), end: hm(13), isBlocked: false },
        { slotId: 'kh-sun', dayOfWeek: SUN, start: hm(9), end: hm(13), isBlocked: false },
      ],
      policy: { allowedCategoryIds: [], allowedAudiences: [], rentPerHour: 300, approvalMode: 'auto' },
    }),
    space({
      id: 's-bibwewadi-lab',
      name: 'Bibwewadi School Lab',
      areaId: 'bibwewadi',
      location: { lng: 73.8655, lat: 18.4772 },
      seatCapacity: 20,
      facilities: [{ facilityTypeId: 'computer', quantity: 20, workingQuantity: 20 }],
      slots: [{ slotId: 'bl-sat', dayOfWeek: SAT, start: hm(10), end: hm(14), isBlocked: false }],
      policy: { allowedCategoryIds: ['coding', 'robotics'], allowedAudiences: [], rentPerHour: 400, approvalMode: 'manual' },
    }),
    space({
      id: 's-sinhagad-library',
      name: 'Sinhagad Road Library',
      areaId: 'sinhagad',
      location: { lng: 73.8265, lat: 18.4755 },
      seatCapacity: 15,
      facilities: [{ facilityTypeId: 'wheelchair', quantity: 1, workingQuantity: 1 }],
      slots: [{ slotId: 'sl-sat', dayOfWeek: SAT, start: hm(14), end: hm(18), isBlocked: false }],
      policy: { allowedCategoryIds: [], allowedAudiences: ['Children', 'Seniors'], rentPerHour: 0, approvalMode: 'auto' },
    }),
    space({
      id: 's-closed-hall',
      name: 'Closed Hall',
      areaId: 'katraj',
      location: { lng: 73.858, lat: 18.451 },
      isActive: false,
      seatCapacity: 50,
      facilities: [{ facilityTypeId: 'computer', quantity: 40, workingQuantity: 40 }],
      slots: [{ slotId: 'ch-sat', dayOfWeek: SAT, start: hm(9), end: hm(18), isBlocked: false }],
    }),
  ];
  const offerings: EngineOffering[] = [
    offering({ id: 'o-coding-a', title: 'Weekend Coding A', batchSize: 12, targetAreaId: 'katraj', windows: [win(SAT, hm(10), hm(12))], maxRentPerHour: 450 }),
    offering({
      id: 'o-coding-b',
      title: 'Weekend Coding B',
      batchSize: 10,
      windows: [win(SAT, hm(9), hm(13)), win(SUN, hm(9), hm(13))],
      maxRentPerHour: 500,
      requirements: [{ facilityTypeId: 'computer', minQuantity: 10 }],
    }),
    offering({
      id: 'o-music',
      title: 'Music for Kids',
      categoryId: 'music',
      audience: 'Children',
      batchSize: 8,
      sessionMinutes: 90,
      windows: [win(SAT, hm(14), hm(17))],
      maxRentPerHour: null,
      feePerMonth: 300,
      requirements: [],
    }),
  ];
  const requests: EngineRequest[] = [];
  for (let i = 0; i < 23; i++) {
    const near = i % 2 === 0 ? katraj : bibwewadi;
    requests.push(
      request({
        id: `coding-${String(i).padStart(2, '0')}`,
        areaId: i % 2 === 0 ? 'katraj' : 'bibwewadi',
        location: around(near, i),
        windows: i % 3 === 0 ? [win(SAT, hm(9), hm(13))] : [],
        budgetPerMonth: i % 4 === 0 ? 800 : null,
        createdAt: `2026-10-0${1 + (i % 9)}T10:00:${String(i).padStart(2, '0')}.000Z`,
      }),
    );
  }
  requests.push(request({ id: 'coding-adult', audience: 'Adults', location: around(katraj, 3), createdAt: '2026-10-02T09:00:00.000Z' }));
  for (let i = 0; i < 4; i++) {
    requests.push(
      request({
        id: `music-${i}`,
        categoryId: 'music',
        audience: 'Children',
        areaId: 'sinhagad',
        location: around(sinhagad, i + 1),
        windows: [win(SAT, hm(14), hm(18))],
        createdAt: `2026-10-03T10:00:0${i}.000Z`,
      }),
    );
  }
  for (let i = 0; i < 2; i++) {
    requests.push(
      request({ id: `robotics-${i}`, categoryId: 'robotics', areaId: 'bibwewadi', location: around(bibwewadi, i + 2), createdAt: `2026-10-04T10:00:0${i}.000Z` }),
    );
  }
  return baseSnapshot({
    spaces,
    offerings,
    requests,
    demandBaseline: [
      { areaId: 'katraj', categoryId: 'coding', baseline: 5 },
      { areaId: 'sinhagad', categoryId: 'music', baseline: 2 },
    ],
  });
}
