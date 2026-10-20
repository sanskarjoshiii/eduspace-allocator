import type { AgeBand } from '@/lib/domain';
import { areaByName } from './data/areas';
import { DEMO_ACCOUNTS, E2E_ACCOUNTS, E2E_SCENARIO } from './constants';
import { monthKey, nextMonthStart } from './generate';
import { offsetKm, type LngLat } from './geo';
import type { PlanLearner, PlanRequest, SeedPlan } from './types';

/**
 * The fixed "weekend coding classes in South Pune" scenario (PLAN 8.4). No randomness:
 * every name, coordinate and number is spelled out so the Playwright spec can rely on it.
 */

const SPACE_LOCATION: LngLat = areaByName('Kothrud').center;

/** [area, distance km from the community centre's area centre, bearing degrees, name, age band] */
const LEARNERS: [string, number, number, string, AgeBand][] = [
  ['Kothrud', 0.3, 40, 'Aarav Kulkarni', '25-40'],
  ['Kothrud', 0.5, 120, 'Ananya Deshpande', '18-24'],
  ['Kothrud', 0.7, 210, 'Rohan Joshi', '18-24'],
  ['Kothrud', 0.9, 300, 'Sneha Patil', '25-40'],
  ['Kothrud', 1.0, 15, 'Kabir Pawar', '18-24'],
  ['Kothrud', 1.2, 260, 'Gauri Apte', '25-40'],
  ['Kothrud', 1.3, 80, 'Nikhil Gokhale', '18-24'],
  ['Kothrud', 1.4, 330, 'Priya Ranade', '41-60'],
  ['Karve Nagar', 0.2, 0, 'Tejas Kale', '18-24'],
  ['Karve Nagar', 0.3, 90, 'Shruti Sawant', '25-40'],
  ['Karve Nagar', 0.4, 180, 'Omkar Jadhav', '18-24'],
  ['Karve Nagar', 0.5, 270, 'Meera Phadke', '25-40'],
  ['Karve Nagar', 0.5, 45, 'Yash Shinde', '18-24'],
  ['Karve Nagar', 0.6, 135, 'Rutuja More', '18-24'],
  // Warje learners sit farthest from the centre (about 3 to 4 km): the expected waitlist.
  ['Warje', 0.4, 200, 'Sahil Chavan', '25-40'],
  ['Warje', 0.7, 190, 'Isha Gaikwad', '18-24'],
  ['Warje', 0.9, 210, 'Parth Mane', '18-24'],
  ['Warje', 1.1, 185, 'Swara Wagh', '25-40'],
];

export function buildE2ePlan(now: Date = new Date()): SeedPlan {
  const s = E2E_SCENARIO;
  const startDate = nextMonthStart(now);

  const learners: PlanLearner[] = LEARNERS.map(([areaName, km, bearing, name, ageBand], i) => {
    const location = offsetKm(areaByName(areaName).center, km, bearing);
    const request: PlanRequest = {
      category: s.category,
      areaName,
      location,
      audience: 'Adults',
      maxDistanceKm: s.maxDistanceKm,
      startMonth: monthKey(startDate),
      durationMonths: 2,
      windows: [{ dayOfWeek: 6, startTime: i % 3 === 0 ? '09:00' : '09:30', endTime: '13:00' }],
      requiredFacilities: [],
      budgetPerMonth: 800,
      notes: i === 0 ? 'Weekend mornings suit me best.' : '',
      intent: 'feasible',
    };
    return {
      account: { email: i === 0 ? E2E_ACCOUNTS.learner : E2E_ACCOUNTS.otherLearner(i + 1), name, role: 'Learner', named: true },
      ageBand,
      contactPhone: `+91 98220 ${String(10_000 + i * 137).padStart(5, '0')}`,
      areaName,
      accessibilityNeeds: [],
      requests: [request],
    };
  });

  learners.push({
    account: { email: E2E_ACCOUNTS.freshLearner, name: 'Disha Iyer', role: 'Learner', named: true },
    ageBand: '18-24',
    contactPhone: '+91 98220 19999',
    areaName: 'Kothrud',
    accessibilityNeeds: [],
    requests: [],
  });

  return {
    spaceGivers: [
      {
        account: { email: DEMO_ACCOUNTS.spaceGiver, name: 'Vaishnavi Deshmukh', role: 'SpaceGiver', named: true },
        partner: {
          type: 'SpaceGiverOrg',
          name: s.spaceGiverName,
          contactPhone: '+91 20 2543 0000',
          about: 'A neighbourhood community centre in Kothrud with a computer lab that is free on weekends.',
        },
        spaces: [
          {
            name: s.spaceName,
            description: 'Computer lab with 30 networked workstations, a projector and Wi-Fi. Free on weekends.',
            address: '12, Paud Road, Kothrud, Pune 411038',
            areaName: s.spaceArea,
            location: SPACE_LOCATION,
            seatCapacity: s.seatCapacity,
            facilities: [
              { facility: 'Computers', quantity: s.computers, workingQuantity: s.computers },
              { facility: 'Projector', quantity: 1, workingQuantity: 1 },
              { facility: 'Wi-Fi', quantity: 1, workingQuantity: 1 },
              { facility: 'Whiteboard', quantity: 1, workingQuantity: 1 },
              { facility: 'Wheelchair access', quantity: 1, workingQuantity: 1 },
            ],
            slots: [
              { dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isBlocked: false },
              { dayOfWeek: 6, startTime: '09:00', endTime: '18:00', isBlocked: false },
            ],
            policy: {
              categories: ['Coding', 'Data and Spreadsheets', 'Digital Literacy'],
              audiences: [],
              rentPerHour: s.rentPerHour,
              approvalMode: 'auto',
              rules: 'Footwear outside. Leave the lab as you found it.',
            },
          },
        ],
      },
    ],
    providers: [
      {
        account: { email: DEMO_ACCOUNTS.provider, name: 'Joel Fernandes', role: 'CourseProvider', named: true },
        partner: {
          type: 'ProviderOrg',
          name: s.providerName,
          contactPhone: '+91 98220 40000',
          about: 'Volunteer-run weekend coding classes for young adults in Pune.',
        },
        courses: [
          {
            title: s.courseTitle,
            description: 'Variables, loops, functions and small projects in Python. No experience needed.',
            category: s.category,
            requirements: [{ facility: 'Computers', minQuantity: s.requiredComputers }],
            offerings: [
              {
                audience: 'Adults',
                batchSize: s.batchSize,
                sessionMinutes: s.sessionMinutes,
                durationWeeks: s.durationWeeks,
                startDate,
                targetAreaName: s.spaceArea,
                windows: [{ ...s.window }],
                maxRentPerHour: s.maxRentPerHour,
                feePerMonth: s.feePerMonth,
                anchorSpaceIndex: 0,
              },
            ],
          },
        ],
      },
    ],
    learners,
  };
}
