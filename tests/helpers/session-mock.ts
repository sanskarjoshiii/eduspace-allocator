import type { SessionUser } from '@/server/auth/session';

let current: SessionUser | null = null;

export function actAs(user: SessionUser | null): void {
  current = user;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return current;
}
