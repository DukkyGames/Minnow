import { isMain, runBoardGateMain } from './run-board-cli.mjs';
import { runConfiguredGate } from './run-board-gate-command.mjs';

export function main(argv = process.argv.slice(2)) {
  return runConfiguredGate({
    gate: 'soak',
    argv,
    script: 'run-board-soak.mjs',
    defaults: { scenarios: ['happy.quick'] },
    specs: {
      iterations: { type: 'integer', min: 1, max: 10_000, default: 100 },
    },
  });
}

if (isMain(import.meta.url)) {
  await runBoardGateMain(() => main());
}
