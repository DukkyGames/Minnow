/**
 * Run all Step 05 mode tests via tsx.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const files = [
  'resolve-mode-prompt.test.mts',
  'load-mode-prompt.test.mts',
  'tool-policy.test.mts',
  'compose-mode.test.mts',
  'chat-mode-persist.test.mts',
];

let failed = false;
for (const file of files) {
  const abs = path.join(__dirname, file);
  const result = spawnSync('npx', ['tsx', '--test', abs], {
    stdio: 'inherit',
    shell: true,
    cwd: path.resolve(__dirname, '../..'),
  });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
