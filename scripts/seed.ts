/**
 * EduSpace seed CLI.
 *
 *   npm run seed                              demo profile, seed 42
 *   npm run seed -- --profile=e2e --reset     wipe and load the Playwright scenario
 *   npm run seed:reset                        wipe and load the demo profile
 *
 * See docs/seed.md.
 *
 * The CLI body is loaded through CommonJS on purpose: under tsx's native-ESM path Node cannot
 * see every named export of Mongoose's CommonJS entry (e.g. `models`), while the CommonJS path
 * reads them all. Loading this way works whichever import style the models use.
 */
import { createRequire } from 'node:module';

const cjsRequire = createRequire(import.meta.url);
const { main } = cjsRequire('./lib/seed-main.ts') as typeof import('./lib/seed-main');

process.exitCode = await main(process.argv.slice(2));
