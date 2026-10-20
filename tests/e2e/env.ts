/**
 * Shared settings for Playwright: the config, the global setup and the specs read these so the
 * seeded database, the web server and the logins always agree.
 */
import { DEFAULT_DEMO_PASSWORD, E2E_ADMIN_DEFAULTS } from '../../src/server/seed/constants';

export { DEMO_ACCOUNTS, E2E_ACCOUNTS, E2E_SCENARIO } from '../../src/server/seed/constants';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3000);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** The throwaway database the e2e profile is seeded into (and the web server reads). */
export const E2E_MONGODB_URI = process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/eduspace_e2e';

export const E2E_ADMIN = {
  email: process.env.ADMIN_SEED_EMAIL || E2E_ADMIN_DEFAULTS.email,
  password: process.env.ADMIN_SEED_PASSWORD || E2E_ADMIN_DEFAULTS.password,
} as const;

/** Password of every seeded non-admin account. */
export const E2E_PASSWORD = process.env.SEED_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;

/**
 * Environment for both the seed and the web server. Real secrets from the shell win; the
 * fallbacks are dummy values that only satisfy the env schema for a local test server.
 */
export function e2eEnv(): Record<string, string> {
  return {
    MONGODB_URI: E2E_MONGODB_URI,
    AUTH_SECRET: process.env.AUTH_SECRET || 'e2e-only-auth-secret-0123456789abcdefghij',
    AUTH_URL: E2E_BASE_URL,
    AUTH_TRUST_HOST: 'true',
    CRON_SECRET: process.env.CRON_SECRET || 'e2e-only-cron-secret-0123456789abcdefghij',
    ADMIN_SEED_EMAIL: E2E_ADMIN.email,
    ADMIN_SEED_PASSWORD: E2E_ADMIN.password,
    SEED_DEMO_PASSWORD: E2E_PASSWORD,
    PORT: String(E2E_PORT),
  };
}

/** The database name in a MongoDB URI ("test" when none is given). */
export function databaseName(uri: string): string {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/i.exec(uri);
  return decodeURIComponent(match?.[1] || 'test');
}
