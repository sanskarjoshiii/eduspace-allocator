// Pure navigation helpers for the shell (no React), unit-tested in tests/unit/ui-nav.test.ts.
import type { MenuItem } from '@/server/auth/menu';
import type { Crumb } from '@/components/ui/navigation';

export type { MenuItem };

/** Accepts the menu endpoint payload as an array or wrapped in { items } / { menu }. */
export function normalizeMenu(data: unknown): MenuItem[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? ((data as { items?: unknown; menu?: unknown }).items ?? (data as { menu?: unknown }).menu)
      : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (m): m is MenuItem =>
      !!m && typeof m === 'object' && typeof (m as MenuItem).label === 'string' && typeof (m as MenuItem).href === 'string',
  );
}

function splitHref(href: string): { path: string; query: URLSearchParams } {
  const [path = '/', q = ''] = href.split('?');
  return { path: path.length > 1 ? path.replace(/\/+$/, '') : path, query: new URLSearchParams(q) };
}

function pathMatches(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * The one menu href (top level or child) that best matches the current location:
 * longest matching path wins; an href with a query wins only when every query pair matches.
 */
export function findActiveHref(menu: readonly MenuItem[], pathname: string, search: URLSearchParams | string = ''): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  let best: { href: string; score: number } | null = null;
  const consider = (href: string) => {
    const { path, query } = splitHref(href);
    if (!pathMatches(pathname, path)) return;
    const pairs = [...query.entries()];
    if (pairs.length > 0 && !pairs.every(([k, v]) => params.get(k) === v)) return;
    const score = path.length * 10 + pairs.length;
    if (!best || score > best.score) best = { href, score };
  };
  for (const item of menu) {
    consider(item.href);
    for (const child of item.children ?? []) consider(child.href);
  }
  return (best as { href: string } | null)?.href ?? null;
}

/** Filters the menu by a search string; a parent stays when it or any child matches. */
export function filterMenu(menu: readonly MenuItem[], q: string): MenuItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...menu];
  const out: MenuItem[] = [];
  for (const item of menu) {
    const children = (item.children ?? []).filter((c) => c.label.toLowerCase().includes(needle));
    if (item.label.toLowerCase().includes(needle)) out.push(item);
    else if (children.length > 0) out.push({ ...item, children });
  }
  return out;
}

const SEGMENT_LABEL: Record<string, string> = {
  new: 'New',
  edit: 'Edit',
  'ui-kit': 'UI Kit',
  sdg: 'SDG Dashboard',
  public: 'Public',
};

const ID_LIKE = /^(?:[a-f\d]{24}|[a-f\d-]{32,36}|\d+)$/i;

/** "demand-insights" -> "Demand Insights"; ids -> "Details". */
export function humanizeSegment(segment: string): string {
  const s = decodeURIComponent(segment);
  if (SEGMENT_LABEL[s]) return SEGMENT_LABEL[s];
  if (ID_LIKE.test(s)) return 'Details';
  return s
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Breadcrumb items for a path using menu labels where possible:
 *   /spaces/abc...   -> Space Registry / Details
 *   /users           -> Settings / Users          (child of Settings)
 *   /settings/lookups -> Settings / Lookups
 */
export function deriveBreadcrumbs(pathname: string, menu: readonly MenuItem[]): Crumb[] {
  const clean = pathname.split('?')[0]!.replace(/\/+$/, '') || '/';
  const segments = clean.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: 'Home', href: '/' }];

  // Find the deepest menu entry whose path is a prefix of the current path.
  let match: { crumbs: Crumb[]; path: string } | null = null;
  for (const item of menu) {
    const top = splitHref(item.href).path;
    const candidates: { crumbs: Crumb[]; path: string }[] = [{ crumbs: [{ label: item.label, href: top }], path: top }];
    for (const child of item.children ?? []) {
      const cp = splitHref(child.href).path;
      if (cp === top) continue; // query-only children (e.g. /spaces?view=policies) do not add a level
      candidates.push({ crumbs: [{ label: item.label, href: top }, { label: child.label, href: cp }], path: cp });
    }
    for (const c of candidates) {
      if (pathMatches(clean, c.path) && (!match || c.path.length > match.path.length)) match = c;
    }
  }

  const crumbs: Crumb[] = match ? [...match.crumbs] : [];
  const consumed = match ? match.path.split('/').filter(Boolean).length : 0;
  let acc = match ? match.path : '';
  for (const seg of segments.slice(consumed)) {
    acc = `${acc}/${seg}`;
    crumbs.push({ label: humanizeSegment(seg), href: acc });
  }
  // Collapse an exact duplicate label (e.g. Settings / Settings).
  return crumbs.filter((c, i) => i === 0 || c.label !== crumbs[i - 1]!.label);
}
