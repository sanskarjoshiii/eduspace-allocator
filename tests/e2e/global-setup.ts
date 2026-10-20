import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_MONGODB_URI, databaseName, e2eEnv } from './env';

/**
 * Seeds the e2e profile into E2E_MONGODB_URI (with --reset) before the suite runs.
 *
 * Safety: the database is wiped, so its name must contain "e2e" or "test" unless
 * E2E_ALLOW_ANY_DB=1. Set E2E_SKIP_SEED=1 when the database was already seeded (CI does this).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_SEED === '1') {
    console.log('[e2e] E2E_SKIP_SEED=1: using the database as it is.');
    return;
  }

  const db = databaseName(E2E_MONGODB_URI);
  if (!/e2e|test/i.test(db) && process.env.E2E_ALLOW_ANY_DB !== '1') {
    throw new Error(
      `[e2e] Refusing to reset database "${db}": its name does not contain "e2e" or "test". ` +
        'Point E2E_MONGODB_URI at a throwaway database, or set E2E_ALLOW_ANY_DB=1.',
    );
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
  console.log(`[e2e] Seeding the e2e profile into "${db}"`);
  // No --env-file here: the e2e run must not pick up a developer's .env.local database.
  execFileSync(process.execPath, [tsxCli, 'scripts/seed.ts', '--profile=e2e', '--reset'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...e2eEnv() },
  });
}
