import type { Role } from '@/lib/domain';

export interface MenuItem {
  label: string;
  href: string;
  /** lucide-react icon name in kebab case, resolved by the client icon map. */
  icon: string;
  children?: { label: string; href: string }[];
}

/**
 * Role menus (README section 17). Served by GET /api/me/menu so the client holds no
 * role logic: adding a page means adding it here.
 */
export const MENUS: Record<Role, MenuItem[]> = {
  Administrator: [
    { label: 'Dashboard', href: '/dashboard', icon: 'house' },
    { label: 'Space Registry', href: '/spaces', icon: 'building-2' },
    { label: 'Learning Requests', href: '/requests', icon: 'inbox' },
    { label: 'Course Offerings', href: '/offerings', icon: 'book-open' },
    { label: 'Smart Allocation', href: '/runs', icon: 'layers' },
    { label: 'Allocation Results', href: '/allocations', icon: 'list-checks' },
    { label: 'Demand Insights', href: '/demand-insights', icon: 'chart-line' },
    { label: 'GIS Mapping', href: '/map', icon: 'map' },
    { label: 'Analytics', href: '/analytics', icon: 'chart-column' },
    { label: 'Facility Issues', href: '/facility-issues', icon: 'triangle-alert' },
    { label: 'Audit Logs', href: '/audit-logs', icon: 'scroll-text' },
    {
      label: 'Social Impact', href: '/impact', icon: 'heart-handshake',
      children: [{ label: 'SDG Dashboard', href: '/sdg' }],
    },
    {
      label: 'Settings', href: '/settings', icon: 'settings-2',
      children: [
        { label: 'Users', href: '/users' },
        { label: 'Notification Templates', href: '/templates' },
        { label: 'Lookups', href: '/settings/lookups' },
      ],
    },
  ],
  Learner: [
    { label: 'Dashboard', href: '/dashboard', icon: 'house' },
    { label: 'My Requests', href: '/requests', icon: 'inbox' },
    { label: 'Offers', href: '/offers', icon: 'ticket' },
    { label: 'Discover Courses', href: '/discover', icon: 'compass' },
    { label: 'Demand Insights', href: '/demand-insights', icon: 'chart-line' },
    { label: 'GIS Map', href: '/map', icon: 'map' },
    { label: 'Social Impact', href: '/impact', icon: 'heart-handshake', children: [{ label: 'SDG Dashboard', href: '/sdg' }] },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
  ],
  SpaceGiver: [
    { label: 'Dashboard', href: '/dashboard', icon: 'house' },
    {
      label: 'My Spaces', href: '/spaces', icon: 'building-2',
      children: [{ label: 'Slots and Policies', href: '/spaces?view=policies' }],
    },
    { label: 'Allocations', href: '/allocations', icon: 'list-checks' },
    { label: 'Matched Requests', href: '/requests', icon: 'inbox' },
    { label: 'Demand Insights', href: '/demand-insights', icon: 'chart-line' },
    { label: 'GIS Map', href: '/map', icon: 'map' },
    { label: 'Facility Issues', href: '/facility-issues', icon: 'triangle-alert' },
    { label: 'Analytics', href: '/analytics', icon: 'chart-column' },
    { label: 'Activity', href: '/audit-logs', icon: 'scroll-text' },
    { label: 'Social Impact', href: '/impact', icon: 'heart-handshake', children: [{ label: 'SDG Dashboard', href: '/sdg' }] },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
  ],
  CourseProvider: [
    { label: 'Dashboard', href: '/dashboard', icon: 'house' },
    { label: 'My Courses', href: '/courses', icon: 'book-open' },
    { label: 'Offerings', href: '/offerings', icon: 'calendar-range' },
    { label: 'Assigned Spaces', href: '/allocations', icon: 'building-2' },
    { label: 'Learners', href: '/learners', icon: 'users' },
    { label: 'Matched Requests', href: '/requests', icon: 'inbox' },
    { label: 'Demand Insights', href: '/demand-insights', icon: 'chart-line' },
    { label: 'GIS Map', href: '/map', icon: 'map' },
    { label: 'Analytics', href: '/analytics', icon: 'chart-column' },
    { label: 'Activity', href: '/audit-logs', icon: 'scroll-text' },
    { label: 'Social Impact', href: '/impact', icon: 'heart-handshake', children: [{ label: 'SDG Dashboard', href: '/sdg' }] },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
  ],
};
