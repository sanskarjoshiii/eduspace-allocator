import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authConfig } from './auth.config';
import { connectDb } from '@/lib/db';
import { User } from '@/server/models';
import { logger } from '@/lib/logger';
import type { Role, UserStatus } from '@/lib/domain';

class AccountBlocked extends CredentialsSignin {
  override code = 'account_blocked';
}

const LoginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: { label: 'Email' }, password: { label: 'Password', type: 'password' } },
      async authorize(raw) {
        const parsed = LoginSchema.safeParse(raw);
        if (!parsed.success) return null;
        await connectDb();
        const user = await User.findOne({ email: parsed.data.email }).select('+passwordHash');
        if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
          logger.info('auth.login_failed', { email: parsed.data.email });
          return null;
        }
        if (user.status !== 'Active') throw new AccountBlocked();
        user.lastLoginAt = new Date();
        await user.save();
        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          role: user.role as Role,
          ownerRefId: user.ownerRefId ? user.ownerRefId.toString() : null,
          status: user.status as UserStatus,
        };
      },
    }),
  ],
});
