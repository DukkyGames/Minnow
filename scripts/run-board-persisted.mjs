import { isMain, runBoardGateMain } from './run-board-cli.mjs';
import { runConfiguredGate } from './run-board-gate-command.mjs';

export function main(argv = process.argv.slice(2)) {
  return runConfiguredGate({
    gate: 'persisted',
    argv,
    script: 'run-board-persisted.mjs',
  });
}

if (isMain(import.meta.url)) {
  await runBoardGateMain(() => main());
}
