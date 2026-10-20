import type { DefaultSession } from 'next-auth';
import type { Role, UserStatus } from '@/lib/domain';

declare module 'next-auth' {
  interface User {
    role: Role;
    ownerRefId: string | null;
    status: UserStatus;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      ownerRefId: string | null;
      status: UserStatus;
    } & DefaultSession['user'];
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    uid?: string;
    role?: Role;
    ownerRefId?: string | null;
    status?: UserStatus;
  }
}
