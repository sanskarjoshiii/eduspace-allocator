import { describe, expect, it } from 'vitest';
import { deriveBreadcrumbs, filterMenu, findActiveHref, humanizeSegment, normalizeMenu } from '@/components/shell/nav-utils';
import { MENUS } from '@/server/auth/menu';

const admin = MENUS.Administrator;
const giver = MENUS.SpaceGiver;

describe('deriveBreadcrumbs', () => {
  it('uses menu labels for top-level pages', () => {
    expect(deriveBreadcrumbs('/dashboard', admin)).toEqual([{ label: 'Dashboard', href: '/dashboard' }]);
    expect(deriveBreadcrumbs('/spaces', admin).map((c) => c.label)).toEqual(['Space Registry']);
  });

  it('labels record ids as Details and keeps the section', () => {
    expect(deriveBreadcrumbs('/spaces/65a1b2c3d4e5f60718293a4b', admin).map((c) => c.label)).toEqual(['Space Registry', 'Details']);
    expect(deriveBreadcrumbs('/spaces/new', giver).map((c) => c.label)).toEqual(['My Spaces', 'New']);
  });

  it('nests children under their parent', () => {
    expect(deriveBreadcrumbs('/users', admin).map((c) => c.label)).toEqual(['Settings', 'Users']);
    expect(deriveBreadcrumbs('/settings/lookups', admin).map((c) => c.label)).toEqual(['Settings', 'Lookups']);
    expect(deriveBreadcrumbs('/sdg', admin).map((c) => c.label)).toEqual(['Social Impact', 'SDG Dashboard']);
  });

  it('humanises paths outside the menu', () => {
    expect(deriveBreadcrumbs('/ui-kit', admin).map((c) => c.label)).toEqual(['UI Kit']);
    expect(humanizeSegment('demand-insights')).toBe('Demand Insights');
  });
});

describe('findActiveHref', () => {
  it('picks the longest matching path', () => {
    expect(findActiveHref(admin, '/spaces/abc')).toBe('/spaces');
    expect(findActiveHref(admin, '/settings/lookups')).toBe('/settings/lookups');
    expect(findActiveHref(admin, '/nowhere')).toBeNull();
  });

  it('prefers a child href whose query matches', () => {
    expect(findActiveHref(giver, '/spaces', 'view=policies')).toBe('/spaces?view=policies');
    expect(findActiveHref(giver, '/spaces', '')).toBe('/spaces');
  });
});

describe('menu helpers', () => {
  it('filters by label and keeps parents of matching children', () => {
    expect(filterMenu(admin, 'templ').map((m) => [m.label, m.children?.map((c) => c.label)])).toEqual([['Settings', ['Notification Templates']]]);
    expect(filterMenu(admin, '')).toHaveLength(admin.length);
  });

  it('normalises array and wrapped payloads', () => {
    expect(normalizeMenu(giver)).toHaveLength(giver.length);
    expect(normalizeMenu({ items: giver })).toHaveLength(giver.length);
    expect(normalizeMenu({ menu: [{ label: 'X' }] })).toEqual([]);
    expect(normalizeMenu(null)).toEqual([]);
  });
});
