import type { NextAuthConfig } from 'next-auth';
import { NextResponse } from 'next/server';
import { canAccessPage, isPublicPath } from '@/lib/access';

/**
 * Edge-safe part of the Auth.js config (no database imports). The proxy uses it to
 * guard pages; src/auth.ts adds the Credentials provider on top.
 */
export const authConfig = {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.ownerRefId = user.ownerRefId;
        token.status = user.status;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid && token.role) {
        session.user.id = token.uid;
        session.user.role = token.role;
        session.user.ownerRefId = token.ownerRefId ?? null;
        session.user.status = token.status ?? 'Active';
      }
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (isPublicPath(pathname)) return true;
      const role = auth?.user?.role;
      if (!role) return false; // redirects to /login with callbackUrl
      if (!canAccessPage(role, pathname)) {
        return NextResponse.redirect(new URL('/dashboard?denied=1', request.nextUrl));
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
