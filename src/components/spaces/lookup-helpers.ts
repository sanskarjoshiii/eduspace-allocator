// Helpers over GET /api/lookups shared by the space, course and offering screens.
import type { Lookups } from '@/hooks/use-lookups';

export interface CategoryNode {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface FacilityTypeOption {
  id: string;
  name: string;
  unit?: string;
}

/** Categories from lookups (the API sends parentId; the hook types it loosely). */
export function lookupCategories(l: Lookups | undefined): CategoryNode[] {
  return (l?.categories ?? []) as CategoryNode[];
}

export function lookupFacilityTypes(l: Lookups | undefined): FacilityTypeOption[] {
  return (l?.facilityTypes ?? []) as FacilityTypeOption[];
}

export interface CategoryOption {
  value: string;
  /** Full path, e.g. "Languages / Spoken English". */
  label: string;
  depth: number;
}

/** Depth-first, name-sorted tree flattened to options with path labels. Orphans are treated as roots. */
export function categoryTreeOptions(categories: readonly CategoryNode[]): CategoryOption[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<string | null, CategoryNode[]>();
  for (const c of categories) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(c);
    children.set(parent, list);
  }
  const out: CategoryOption[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, path: string[], depth: number) => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    for (const c of list) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const p = [...path, c.name];
      out.push({ value: c.id, label: p.join(' / '), depth });
      walk(c.id, p, depth + 1);
    }
  };
  walk(null, [], 0);
  return out;
}

export function nameMap(list: readonly { id: string; name: string }[]): Record<string, string> {
  return Object.fromEntries(list.map((x) => [x.id, x.name]));
}
