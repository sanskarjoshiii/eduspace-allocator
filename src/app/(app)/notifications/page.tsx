import type { Metadata } from 'next';
import { NotificationsView } from '@/components/notifications/notifications-view';

export const metadata: Metadata = { title: 'Notifications' };

/** All roles: the caller's notifications (PLAN 5.3). */
export default function NotificationsPage() {
  return <NotificationsView />;
}
