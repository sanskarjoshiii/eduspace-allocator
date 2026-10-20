import type { IncomeGroup } from '@/lib/domain';
import type { LngLat } from '../geo';
import { Rng } from '../prng';

/**
 * Pune localities. Names and centre coordinates are real (approximate locality centres).
 *
 * SYNTHETIC: population, studentCount, literacyRate, incomeScore and incomeGroup are NOT
 * census figures. They are generated deterministically from a fixed seed (AREA_SEED) and a
 * rough per-locality profile so that K-Means has realistic-looking variation to work with.
 * Replace them with sourced data when it is available (PLAN.md, Dependencies table).
 */
interface AreaSource {
  name: string;
  center: LngLat;
  pincode: string;
  /** Rough affluence hint 0..1 that the synthetic income score is drawn around. */
  affluence: number;
  /** Rough size hint 0..1 that the synthetic population is drawn around. */
  size: number;
}

const SOURCES: AreaSource[] = [
  { name: 'Kothrud', center: [73.8077, 18.5074], pincode: '411038', affluence: 0.7, size: 0.9 },
  { name: 'Karve Nagar', center: [73.8195, 18.4893], pincode: '411052', affluence: 0.6, size: 0.5 },
  { name: 'Warje', center: [73.8028, 18.4847], pincode: '411058', affluence: 0.4, size: 0.7 },
  { name: 'Erandwane', center: [73.8306, 18.5089], pincode: '411004', affluence: 0.85, size: 0.35 },
  { name: 'Deccan', center: [73.841, 18.5167], pincode: '411004', affluence: 0.75, size: 0.3 },
  { name: 'Shivajinagar', center: [73.8478, 18.5308], pincode: '411005', affluence: 0.6, size: 0.55 },
  { name: 'Aundh', center: [73.8077, 18.559], pincode: '411007', affluence: 0.85, size: 0.6 },
  { name: 'Baner', center: [73.7868, 18.559], pincode: '411045', affluence: 0.9, size: 0.65 },
  { name: 'Hadapsar', center: [73.9259, 18.5089], pincode: '411028', affluence: 0.4, size: 1.0 },
  { name: 'Viman Nagar', center: [73.9143, 18.5679], pincode: '411014', affluence: 0.85, size: 0.5 },
  { name: 'Kondhwa', center: [73.8885, 18.4669], pincode: '411048', affluence: 0.35, size: 0.8 },
  { name: 'Katraj', center: [73.8636, 18.4529], pincode: '411046', affluence: 0.3, size: 0.75 },
  { name: 'Bibwewadi', center: [73.864, 18.471], pincode: '411037', affluence: 0.45, size: 0.6 },
  { name: 'Sinhagad Road', center: [73.818, 18.473], pincode: '411041', affluence: 0.45, size: 0.85 },
  { name: 'Dhayari', center: [73.81, 18.448], pincode: '411041', affluence: 0.3, size: 0.6 },
  { name: 'Bavdhan', center: [73.7804, 18.5196], pincode: '411021', affluence: 0.75, size: 0.4 },
  { name: 'Pashan', center: [73.796, 18.537], pincode: '411021', affluence: 0.65, size: 0.45 },
  { name: 'Yerawada', center: [73.892, 18.552], pincode: '411006', affluence: 0.25, size: 0.7 },
  { name: 'Kharadi', center: [73.941, 18.551], pincode: '411014', affluence: 0.75, size: 0.6 },
  { name: 'Wakad', center: [73.76, 18.598], pincode: '411057', affluence: 0.7, size: 0.7 },
  { name: 'Pimple Saudagar', center: [73.799, 18.598], pincode: '411027', affluence: 0.65, size: 0.55 },
  { name: 'Swargate', center: [73.857, 18.501], pincode: '411042', affluence: 0.4, size: 0.5 },
  { name: 'Camp', center: [73.879, 18.515], pincode: '411001', affluence: 0.6, size: 0.4 },
  { name: 'Wanowrie', center: [73.9, 18.488], pincode: '411040', affluence: 0.6, size: 0.5 },
];

/** "South Pune" in the end-to-end scenario and the demo. */
export const SOUTH_PUNE = ['Kothrud', 'Karve Nagar', 'Warje', 'Erandwane', 'Sinhagad Road', 'Dhayari', 'Katraj', 'Bibwewadi'] as const;

/**
 * Areas where the generator never places a space, so "far from any space" requests
 * can be built there. They are on the outer edge of the city.
 */
export const NO_SPACE_AREAS = ['Wakad', 'Pimple Saudagar', 'Kharadi', 'Wanowrie'] as const;

export interface AreaSeed {
  name: string;
  city: 'Pune';
  center: LngLat;
  pincode: string;
  population: number;
  studentCount: number;
  literacyRate: number;
  incomeScore: number;
  incomeGroup: IncomeGroup;
}

/** Fixed: areas are part of the base seed and must not change with --seed. */
export const AREA_SEED = 2026;

export function incomeGroupFor(score: number): IncomeGroup {
  if (score < 40) return 'Low';
  if (score < 70) return 'Medium';
  return 'High';
}

function buildAreas(): AreaSeed[] {
  const rng = new Rng(AREA_SEED);
  return SOURCES.map((s) => {
    const population = Math.round((60_000 + s.size * 190_000 + rng.range(-15_000, 15_000)) / 100) * 100;
    // Lower-income areas skew younger: a slightly larger student share.
    const studentShare = 0.15 + (1 - s.affluence) * 0.05 + rng.range(-0.015, 0.015);
    const incomeScore = Math.round(Math.min(98, Math.max(8, s.affluence * 100 + rng.range(-8, 8))));
    const literacyRate = Math.round(Math.min(98.5, Math.max(70, 80 + s.affluence * 15 + rng.range(-2.5, 2.5))) * 10) / 10;
    return {
      name: s.name,
      city: 'Pune',
      center: s.center,
      pincode: s.pincode,
      population,
      studentCount: Math.round((population * studentShare) / 10) * 10,
      literacyRate,
      incomeScore,
      incomeGroup: incomeGroupFor(incomeScore),
    };
  });
}

export const AREAS: readonly AreaSeed[] = buildAreas();
export type AreaName = (typeof SOURCES)[number]['name'];

export function areaByName(name: string): AreaSeed {
  const area = AREAS.find((a) => a.name === name);
  if (!area) throw new Error(`Unknown seed area: ${name}`);
  return area;
}
