import { auth } from '@/auth';
import type { Role, UserStatus } from '@/lib/domain';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  ownerRefId: string | null;
  status: UserStatus;
}

/**
 * Reads the signed-in user from the Auth.js session. Tests replace this module with
 * vi.mock('@/server/auth/session') to act as any role.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.role) return null;
  return {
    id: u.id,
    email: u.email ?? '',
    name: u.name ?? '',
    role: u.role,
    ownerRefId: u.ownerRefId ?? null,
    status: u.status ?? 'Active',
  };
}
