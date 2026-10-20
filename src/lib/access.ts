import type { Role } from './domain';

/**
 * Page access by path prefix. The proxy redirects a signed-in user who opens a page
 * their role cannot use; route handlers enforce the same rules server-side.
 * Prefixes not listed are open to every signed-in role.
 */
export const PAGE_ACCESS: { prefix: string; roles: readonly Role[] }[] = [
  { prefix: '/settings', roles: ['Administrator'] },
  { prefix: '/runs', roles: ['Administrator'] },
  { prefix: '/users', roles: ['Administrator'] },
  { prefix: '/templates', roles: ['Administrator'] },
  { prefix: '/analytics', roles: ['Administrator', 'SpaceGiver', 'CourseProvider'] },
  { prefix: '/audit-logs', roles: ['Administrator', 'SpaceGiver', 'CourseProvider'] },
  { prefix: '/offers', roles: ['Learner', 'Administrator'] },
  { prefix: '/discover', roles: ['Learner', 'Administrator'] },
  { prefix: '/requests/new', roles: ['Learner'] },
  { prefix: '/spaces/new', roles: ['SpaceGiver', 'Administrator'] },
  { prefix: '/courses', roles: ['CourseProvider', 'Administrator'] },
  { prefix: '/offerings/new', roles: ['CourseProvider', 'Administrator'] },
  { prefix: '/learners', roles: ['CourseProvider', 'Administrator'] },
  { prefix: '/facility-issues', roles: ['SpaceGiver', 'Administrator'] },
];

export const PUBLIC_PATHS = ['/', '/login', '/register', '/impact/public'];

export function canAccessPage(role: Role, pathname: string): boolean {
  const rule = PAGE_ACCESS.filter((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return rule ? rule.roles.includes(role) : true;
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/api/') || pathname.startsWith('/_next');
}
