/** Body of the seed CLI (scripts/seed.ts loads it). See docs/seed.md. */
import { disconnectDb } from '../../src/lib/db';
import { runSeed, SeedRefusedError, type SeedResult } from '../../src/server/seed';
import { ArgError, parseSeedArgs, SEED_HELP } from './args';
import { formatTable } from './table';

function printSummary(result: SeedResult): void {
  console.log('');
  console.log(`Seeded profile "${result.profile}" (seed ${result.seed}) into database "${result.database}" on ${result.host}`);
  if (result.profileData.status === 'inserted' && result.mix) {
    const m = result.mix;
    console.log(
      `Requests: ${m.total} total, ${m.feasible} feasible, ${m.total - m.feasible} infeasible ` +
        `(far ${m.far}, category ${m.category}, budget ${m.budget}, facility ${m.facility}, time ${m.time})`,
    );
  }
  console.log('');
  console.log(formatTable(['Collection', 'Count'], Object.entries(result.counts)));
  const b = result.base;
  console.log('');
  console.log(
    `Inserted this run: ${b.facilityTypes} facility types, ${b.courseCategories} categories, ${b.areas} areas, ` +
      `${b.studentDemand} demand rows, ${b.settings} settings, ${b.templates} templates`,
  );

  if (result.logins.length > 0) {
    const shown = result.logins.slice(0, 8);
    console.log('');
    console.log('Logins');
    console.log(formatTable(['Role', 'Email', 'Password'], shown.map((l) => [l.role, l.email, l.password])));
    if (result.logins.length > shown.length) console.log(`… and ${result.logins.length - shown.length} more with the same password (see docs/seed.md)`);
  }
  console.log('');
  console.log('Queued one manual.trigger event: the next worker tick runs Smart Allocation.');
}

export async function main(argv: readonly string[]): Promise<number> {
  let args;
  try {
    args = parseSeedArgs(argv);
  } catch (err) {
    if (err instanceof ArgError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }
  if (args.help) {
    console.log(SEED_HELP);
    return 0;
  }

  try {
    const started = Date.now();
    const result = await runSeed({
      profile: args.profile,
      seed: args.seed,
      reset: args.reset,
      yesReally: args.yesReally,
      uri: process.env.MONGODB_URI,
      adminEmail: process.env.ADMIN_SEED_EMAIL,
      adminPassword: process.env.ADMIN_SEED_PASSWORD,
      demoPassword: process.env.SEED_DEMO_PASSWORD,
    });
    printSummary(result);
    console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return 0;
  } catch (err) {
    if (err instanceof SeedRefusedError) {
      console.error(err.message);
      return 1;
    }
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await disconnectDb();
  }
}

