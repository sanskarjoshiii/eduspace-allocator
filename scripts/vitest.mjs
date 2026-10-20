// Runs Vitest with an uppercase drive letter in the working directory.
// On Windows, a cwd of c:\ (lowercase) makes Vitest load twice through two path spellings
// and every suite fails with "Vitest failed to find the current suite".
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url))).replace(/^[a-z]:/, (d) => d.toUpperCase());
const cli = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
