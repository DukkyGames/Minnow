import path from 'node:path';
import {
  BOARD_GATE_EXIT,
  loadBoardGateAdapter,
  parseBoardGateArgs,
  resolveCatalogScenarios,
  runManagedBoardGate,
} from './run-board-cli.mjs';

export const DEFAULT_PERSISTED_GATE_ADAPTER = path.resolve(
  import.meta.dirname,
  '../test/orchestrate/persisted/gate-adapter.mts',
);

const COMMON_SPECS = {
  scenario: { type: 'string', multiple: true },
  adapter: { type: 'string' },
  iterations: { type: 'integer', min: 1, max: 10_000, default: 1 },
  timeout_ms: { type: 'integer', min: 50, max: 3_600_000, default: 120_000 },
  seed: { type: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER, default: 513 },
  help: { type: 'boolean' },
};

export function gateUsage(script, extras = '') {
  return [
    `node --import tsx scripts/${script}`,
    '[--scenario <id>] [--adapter <module>] [--iterations <n>]',
    '[--timeout-ms <n>] [--seed <n>]',
    extras,
  ]
    .filter(Boolean)
    .join(' ');
}

export async function runConfiguredGate({
  gate,
  argv,
  script,
  defaults = {},
  specs = {},
  checkpoints = [],
  adapterContext = {},
  usageExtras = '',
}) {
  const args = parseBoardGateArgs(argv, { ...COMMON_SPECS, ...specs });
  if (args.help) {
    return {
      gate,
      classification: 'pass',
      exitCode: BOARD_GATE_EXIT.success,
      usage: gateUsage(script, usageExtras),
    };
  }
  const scenarios = await resolveCatalogScenarios(
    args.scenario?.length ? args.scenario : defaults.scenarios ?? [],
  );
  const selectedCheckpoints =
    typeof checkpoints === 'function' ? await checkpoints(args) : checkpoints;
  const selectedAdapterContext =
    typeof adapterContext === 'function' ? await adapterContext(args) : adapterContext;
  const defaultAdapter =
    gate === 'persisted' || gate === 'restart' || gate === 'soak'
      ? DEFAULT_PERSISTED_GATE_ADAPTER
      : undefined;
  const createDriver = await loadBoardGateAdapter(args.adapter ?? defaultAdapter, gate);
  return runManagedBoardGate({
    gate,
    scenarios,
    adapter: createDriver,
    iterations: args.iterations ?? defaults.iterations ?? 1,
    timeoutMs: args.timeout_ms,
    baseSeed: args.seed,
    checkpoints: selectedCheckpoints,
    adapterContext: selectedAdapterContext,
  });
}
