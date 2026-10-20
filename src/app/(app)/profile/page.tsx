import type { Metadata } from 'next';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'Profile' };

/** All roles: name, contact phone, email notifications; learners also accessibility needs and home area. */
export default function ProfilePage() {
  return <ProfileForm />;
}
