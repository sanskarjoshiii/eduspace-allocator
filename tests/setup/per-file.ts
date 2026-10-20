import { afterAll, inject } from 'vitest';
import mongoose from 'mongoose';

// Each test file gets its own database on the shared replica set.
const base = inject('mongoUri');
const dbName = `t_${Math.random().toString(36).slice(2, 10)}`;
const url = new URL(base);
url.pathname = `/${dbName}`;

process.env.MONGODB_URI = url.toString();
process.env.AUTH_SECRET ??= 'test-auth-secret-at-least-32-characters-long';
process.env.CRON_SECRET ??= 'test-cron-secret-1234567890';
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'test';

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.db?.dropDatabase();
    const { disconnectDb } = await import('@/lib/db');
    await disconnectDb();
  }
});
