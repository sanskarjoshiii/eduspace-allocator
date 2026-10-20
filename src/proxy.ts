import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

// Optimistic page guard: signed-out users go to /login, wrong-role users to /dashboard.
// Route handlers re-check everything server-side with withAuth.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
