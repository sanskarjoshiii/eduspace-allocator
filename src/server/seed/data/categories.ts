/** Course category tree (PLAN 2.1). Siblings under one parent count as "similar" for suggestions. */
export const CATEGORY_TREE = {
  Technology: ['Coding', 'Data and Spreadsheets', 'Digital Literacy'],
  Arts: ['Drawing and Painting', 'Craft'],
  'Performing Arts': ['Dance', 'Music', 'Theatre'],
  Academic: ['Mathematics Tuition', 'Science Tuition', 'English Tuition'],
  Languages: ['Spoken English', 'Marathi', 'Hindi'],
  'Life Skills': ['Financial Literacy'],
} as const;

type Tree = typeof CATEGORY_TREE;
export type ParentCategory = keyof Tree;
export type LeafCategory = Tree[ParentCategory][number];
export type CategoryName = ParentCategory | LeafCategory;

export const PARENT_CATEGORIES = Object.keys(CATEGORY_TREE) as ParentCategory[];
export const LEAF_CATEGORIES: readonly LeafCategory[] = PARENT_CATEGORIES.flatMap((p) => [...CATEGORY_TREE[p]]);

export function parentOf(leaf: LeafCategory): ParentCategory {
  return PARENT_CATEGORIES.find((p) => (CATEGORY_TREE[p] as readonly string[]).includes(leaf))!;
}

/**
 * Categories no generated provider offers, so requests for them are infeasible by design
 * ("category nobody offers") and show up as gaps in Demand Insights.
 */
export const UNOFFERED_CATEGORIES: readonly LeafCategory[] = ['Theatre', 'Hindi', 'Financial Literacy'];

/** Relative popularity used for demand baselines and for picking request categories. */
export const CATEGORY_POPULARITY: Record<LeafCategory, number> = {
  Coding: 1.0,
  'Data and Spreadsheets': 0.55,
  'Digital Literacy': 0.6,
  'Drawing and Painting': 0.5,
  Craft: 0.3,
  Dance: 0.8,
  Music: 0.6,
  Theatre: 0.25,
  'Mathematics Tuition': 0.95,
  'Science Tuition': 0.75,
  'English Tuition': 0.65,
  'Spoken English': 0.85,
  Marathi: 0.3,
  Hindi: 0.25,
  'Financial Literacy': 0.35,
};
