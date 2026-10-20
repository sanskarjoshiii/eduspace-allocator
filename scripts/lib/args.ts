import { SEED_PROFILES, type SeedProfile } from '../../src/server/seed/constants';

export interface SeedArgs {
  profile: SeedProfile;
  seed: number | undefined;
  reset: boolean;
  yesReally: boolean;
  help: boolean;
}

export class ArgError extends Error {}

/** Parses `--profile=demo --reset --yes-really --seed=7` (also accepts `--profile demo`). */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const out: SeedArgs = { profile: 'demo', seed: undefined, reset: false, yesReally: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    if (raw === '--') continue;
    const [flag, inline] = raw.includes('=') ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)] : [raw, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith('--')) throw new ArgError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--profile': {
        const v = value();
        if (!(SEED_PROFILES as readonly string[]).includes(v)) throw new ArgError(`Unknown profile "${v}". Use one of: ${SEED_PROFILES.join(', ')}`);
        out.profile = v as SeedProfile;
        break;
      }
      case '--seed': {
        const v = Number(value());
        if (!Number.isInteger(v) || v < 0) throw new ArgError('--seed must be a non-negative integer');
        out.seed = v;
        break;
      }
      case '--reset':
        out.reset = true;
        break;
      case '--yes-really':
        out.yesReally = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        throw new ArgError(`Unknown option "${raw}". Run with --help.`);
    }
  }
  return out;
}

export const SEED_HELP = `Usage: npm run seed -- [options]

  --profile=<name>  minimal | demo | e2e | bench   (default: demo)
  --seed=<n>        random seed for generated data (default: 42)
  --reset           drop every EduSpace collection first
  --yes-really      allow --reset against a production-looking (Atlas) host

Environment: MONGODB_URI (required), ADMIN_SEED_EMAIL + ADMIN_SEED_PASSWORD (admin is skipped
without both), SEED_DEMO_PASSWORD (demo accounts; default Demo-Pass-2026).`;
