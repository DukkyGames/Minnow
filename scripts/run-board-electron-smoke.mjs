import path from 'node:path';
import {
  BOARD_GATE_EXIT,
  BoardGateError,
  isMain,
  runBoardGateMain,
} from './run-board-cli.mjs';
import { runConfiguredGate } from './run-board-gate-command.mjs';

export function main(argv = process.argv.slice(2)) {
  return runConfiguredGate({
    gate: 'electron-smoke',
    argv,
    script: 'run-board-electron-smoke.mjs',
    defaults: { scenarios: ['happy.quick'] },
    specs: {
      package_path: { type: 'string' },
    },
    adapterContext: (args) => {
      if (!args.package_path) {
        throw new BoardGateError(
          'Electron smoke requires --package-path',
          'usage',
          BOARD_GATE_EXIT.usage,
        );
      }
      return { packagePath: path.resolve(args.package_path) };
    },
    usageExtras: '--package-path <path>',
  });
}

if (isMain(import.meta.url)) {
  await runBoardGateMain(() => main());
}
