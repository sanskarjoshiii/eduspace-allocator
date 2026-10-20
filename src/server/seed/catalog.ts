import type { Audience } from '@/lib/domain';
import type { LeafCategory } from './data/categories';
import type { FacilityName } from './data/facilities';
import type { Rng } from './prng';

/** The kinds of venue the generator builds, with realistic facilities and policies. */
export type SpaceKindKey = 'lab' | 'hall' | 'dance' | 'classroom' | 'music' | 'art';

export interface SpaceKind {
  key: SpaceKindKey;
  /** `{p}` is replaced with an organisation prefix. */
  names: readonly string[];
  description: string;
  seats: [number, number];
  facilities: (rng: Rng, seats: number) => { facility: FacilityName; quantity: number; workingQuantity: number }[];
  /** Categories the venue's policy allows. Empty = all. */
  categories: (rng: Rng) => LeafCategory[];
  audiences: (rng: Rng) => Audience[];
}

/** Quantity plus a working quantity that is occasionally a little lower (broken units). */
function item(rng: Rng, facility: FacilityName, quantity: number, brokenChance = 0.25, maxBroken = 2) {
  const broken = rng.chance(brokenChance) ? rng.int(1, Math.min(maxBroken, Math.max(0, quantity - 1))) : 0;
  return { facility, quantity, workingQuantity: Math.max(0, quantity - broken) };
}

export const SPACE_KINDS: Record<SpaceKindKey, SpaceKind> = {
  lab: {
    key: 'lab',
    names: ['{p} Vidyalaya Computer Lab', '{p} College IT Lab', '{p} High School Computer Lab', '{p} Digital Learning Centre'],
    description: 'Computer lab with networked workstations, used for school classes on weekdays until 5 pm.',
    seats: [20, 40],
    facilities: (rng, seats) => {
      const out = [item(rng, 'Computers', seats, 0.5, 3), item(rng, 'Projector', 1, 0), item(rng, 'Wi-Fi', 1, 0), item(rng, 'Whiteboard', 1, 0)];
      if (rng.chance(0.6)) out.push(item(rng, 'Air conditioning', rng.int(1, 2), 0));
      if (rng.chance(0.4)) out.push(item(rng, 'Wheelchair access', 1, 0));
      return out;
    },
    categories: (rng) => (rng.chance(0.5) ? ['Coding', 'Data and Spreadsheets', 'Digital Literacy'] : ['Coding', 'Data and Spreadsheets', 'Digital Literacy', 'Mathematics Tuition']),
    audiences: (rng) => (rng.chance(0.3) ? ['Children', 'Teens'] : []),
  },
  hall: {
    key: 'hall',
    names: ['{p} Community Hall', '{p} Samaj Mandir Hall', '{p} Sabhagruha', '{p} Society Clubhouse'],
    description: 'Multi-purpose community hall with movable seating. Free most weekday evenings and weekends.',
    seats: [40, 90],
    facilities: (rng) => {
      const out = [item(rng, 'Whiteboard', 1, 0), item(rng, 'Music system', 1, 0.1, 1), item(rng, 'Wheelchair access', 1, 0)];
      if (rng.chance(0.7)) out.push(item(rng, 'Projector', 1, 0.15, 1));
      if (rng.chance(0.6)) out.push(item(rng, 'Dance floor', rng.step(80, 160, 10), 0));
      if (rng.chance(0.5)) out.push(item(rng, 'Wi-Fi', 1, 0));
      return out;
    },
    categories: (rng) =>
      rng.chance(0.5) ? [] : ['Drawing and Painting', 'Craft', 'Theatre', 'Spoken English', 'Mathematics Tuition', 'Science Tuition', 'English Tuition', 'Marathi', 'Financial Literacy'],
    audiences: () => [],
  },
  dance: {
    key: 'dance',
    names: ['{p} Dance Studio', '{p} Nritya Studio', '{p} Movement Studio'],
    description: 'Studio with a sprung floor, wall mirrors and a sound system.',
    seats: [15, 35],
    facilities: (rng) => [
      item(rng, 'Dance floor', rng.step(60, 140, 10), 0),
      item(rng, 'Mirrors', rng.int(4, 10), 0.2, 1),
      item(rng, 'Music system', 1, 0),
      item(rng, 'Air conditioning', rng.int(1, 3), 0.1, 1),
    ],
    categories: () => ['Dance', 'Music', 'Theatre'],
    audiences: () => [],
  },
  classroom: {
    key: 'classroom',
    names: ['{p} Vidyalaya Classroom', '{p} Study Centre', '{p} Shikshan Kendra', '{p} Tuition Hall'],
    description: 'Classroom with benches and a board, available after school hours.',
    seats: [25, 45],
    facilities: (rng) => {
      const out = [item(rng, 'Whiteboard', rng.int(1, 2), 0)];
      if (rng.chance(0.5)) out.push(item(rng, 'Projector', 1, 0.2, 1));
      if (rng.chance(0.5)) out.push(item(rng, 'Wi-Fi', 1, 0));
      if (rng.chance(0.3)) out.push(item(rng, 'Wheelchair access', 1, 0));
      return out;
    },
    categories: (rng) =>
      rng.chance(0.5)
        ? ['Mathematics Tuition', 'Science Tuition', 'English Tuition', 'Spoken English', 'Marathi', 'Hindi']
        : ['Mathematics Tuition', 'Science Tuition', 'English Tuition', 'Spoken English', 'Marathi', 'Hindi', 'Financial Literacy', 'Drawing and Painting'],
    audiences: (rng) => (rng.chance(0.25) ? ['Children', 'Teens'] : []),
  },
  music: {
    key: 'music',
    names: ['{p} Sangeet Room', '{p} Music Room', '{p} Sangeet Vidyalaya'],
    description: 'Music room with keyboards and a sound system.',
    seats: [10, 25],
    facilities: (rng) => [
      item(rng, 'Musical instruments', rng.int(6, 15), 0.4, 2),
      item(rng, 'Music system', 1, 0),
      item(rng, 'Whiteboard', 1, 0),
    ],
    categories: () => ['Music'],
    audiences: () => [],
  },
  art: {
    key: 'art',
    names: ['{p} Art Room', '{p} Kala Kendra', '{p} Craft Studio'],
    description: 'Bright room with large tables for art and craft.',
    seats: [15, 30],
    facilities: (rng) => {
      const out = [item(rng, 'Whiteboard', 1, 0)];
      if (rng.chance(0.4)) out.push(item(rng, 'Wi-Fi', 1, 0));
      return out;
    },
    categories: () => ['Drawing and Painting', 'Craft'],
    audiences: () => [],
  },
};

/** The order the generator cycles through, so every kind appears even in small datasets. */
export const SPACE_KIND_CYCLE: readonly SpaceKindKey[] = ['lab', 'hall', 'classroom', 'dance', 'lab', 'music', 'art', 'classroom', 'hall'];

/** Facility requirements a course in `category` needs for a batch of `batch` learners. */
export function requirementsFor(category: LeafCategory, batch: number): { facility: FacilityName; minQuantity: number }[] {
  switch (category) {
    case 'Coding':
    case 'Data and Spreadsheets':
      return [{ facility: 'Computers', minQuantity: batch }];
    case 'Digital Literacy':
      return [{ facility: 'Computers', minQuantity: Math.ceil(batch / 2) }];
    case 'Dance':
      return [
        { facility: 'Dance floor', minQuantity: batch * 3 },
        { facility: 'Mirrors', minQuantity: 1 },
        { facility: 'Music system', minQuantity: 1 },
      ];
    case 'Music':
      return [
        { facility: 'Musical instruments', minQuantity: Math.ceil(batch / 2) },
        { facility: 'Music system', minQuantity: 1 },
      ];
    case 'Theatre':
      return [{ facility: 'Music system', minQuantity: 1 }];
    case 'Financial Literacy':
      return [{ facility: 'Projector', minQuantity: 1 }];
    case 'Mathematics Tuition':
    case 'Science Tuition':
    case 'English Tuition':
    case 'Spoken English':
    case 'Marathi':
    case 'Hindi':
      return [{ facility: 'Whiteboard', minQuantity: 1 }];
    case 'Drawing and Painting':
    case 'Craft':
      return [];
  }
}

export const COURSE_TITLES: Record<LeafCategory, readonly string[]> = {
  Coding: ['Python Basics', 'Scratch for Kids', 'Web Development with HTML and CSS', 'Intro to JavaScript'],
  'Data and Spreadsheets': ['Excel for Everyday Work', 'Data Basics with Google Sheets'],
  'Digital Literacy': ['Smartphone and Internet Basics', 'Digital Payments and Online Safety'],
  'Drawing and Painting': ['Watercolour Fundamentals', 'Sketching for Beginners'],
  Craft: ['Paper Craft and Origami', 'Warli Art Workshop'],
  Dance: ['Kathak for Beginners', 'Bollywood Dance Fitness', 'Contemporary Dance Basics'],
  Music: ['Keyboard Basics', 'Hindustani Vocal Foundations'],
  Theatre: ['Street Theatre Workshop'],
  'Mathematics Tuition': ['Class 8 to 10 Mathematics', 'Foundation Maths'],
  'Science Tuition': ['Class 9 and 10 Science', 'Hands-on Physics'],
  'English Tuition': ['English Grammar and Writing'],
  'Spoken English': ['Spoken English for Beginners', 'English for Interviews'],
  Marathi: ['Marathi for Newcomers'],
  Hindi: ['Conversational Hindi'],
  'Financial Literacy': ['Money Basics for Young Adults'],
};

/** Provider organisation name suffixes by the family of categories they teach. */
export const PROVIDER_SUFFIX: Record<string, readonly string[]> = {
  Technology: ['Code Academy', 'Digital Skills Institute', 'Tech Learning Hub'],
  Arts: ['Art Studio', 'Kala Academy'],
  'Performing Arts': ['Dance Academy', 'Sangeet Vidyalaya', 'Performing Arts School'],
  Academic: ['Tuition Classes', 'Study Circle', 'Learning Centre'],
  Languages: ['Language Centre', 'English Academy'],
};

/** Typical audience for a category's offerings. */
export function audiencesFor(category: LeafCategory): Audience[] {
  switch (category) {
    case 'Mathematics Tuition':
    case 'Science Tuition':
    case 'English Tuition':
      return ['Teens', 'Children'];
    case 'Digital Literacy':
      return ['Adults', 'Seniors'];
    case 'Coding':
      return ['Teens', 'Adults', 'Children'];
    case 'Drawing and Painting':
    case 'Craft':
      return ['Children', 'Adults'];
    default:
      return ['Adults', 'Teens'];
  }
}
