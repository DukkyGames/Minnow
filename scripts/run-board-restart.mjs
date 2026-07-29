import { importTsModule } from '../server/orchestrate/board-testing/ts-import.js';
import {
  BOARD_GATE_EXIT,
  BoardGateError,
  isMain,
  runBoardGateMain,
} from './run-board-cli.mjs';
import { runConfiguredGate } from './run-board-gate-command.mjs';
import { DEFAULT_PERSISTED_RESTART_CHECKPOINTS } from '../test/orchestrate/persisted/gate-adapter.mts';

async function selectedCheckpoints(args) {
  const { SCENARIO_CHECKPOINTS } = await importTsModule(
    '../../../src/dev/orchestrate-scenarios/index.ts',
  );
  const harnessCheckpoints = [
    ...DEFAULT_PERSISTED_RESTART_CHECKPOINTS,
    'server-ready',
    'fake-model-start',
    'board-seed',
    'worktree-create',
    'active-board',
  ];
  const requested = args.checkpoint?.length
    ? args.checkpoint.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
    : [...DEFAULT_PERSISTED_RESTART_CHECKPOINTS];
  const known = new Set([...SCENARIO_CHECKPOINTS, ...harnessCheckpoints]);
  const unknown = requested.filter((value) => !known.has(value));
  if (unknown.length) {
    throw new BoardGateError(
      `Unknown restart checkpoint: ${unknown.join(', ')}`,
      'usage',
      BOARD_GATE_EXIT.usage,
    );
  }
  return [...new Set(requested)];
}

export function main(argv = process.argv.slice(2)) {
  return runConfiguredGate({
    gate: 'restart',
    argv,
    script: 'run-board-restart.mjs',
    specs: {
      checkpoint: { type: 'string', multiple: true },
    },
    checkpoints: selectedCheckpoints,
    usageExtras: '[--checkpoint <name>]',
  });
}

if (isMain(import.meta.url)) {
  await runBoardGateMain(() => main());
}
