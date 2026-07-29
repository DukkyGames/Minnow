import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ScenarioRunManager } from '../server/orchestrate/board-testing/scenario-runner.js';
import { importTsModule } from '../server/orchestrate/board-testing/ts-import.js';

export const BOARD_GATE_EXIT = Object.freeze({
  success: 0,
  gateFailure: 1,
  usage: 2,
  timeout: 3,
  harnessError: 70,
  unsupported: 78,
});

export class BoardGateError extends Error {
  constructor(message, classification = 'harness_error', exitCode = BOARD_GATE_EXIT.harnessError) {
    super(message);
    this.name = 'BoardGateError';
    this.classification = classification;
    this.exitCode = exitCode;
  }
}

function optionName(token) {
  return token.slice(2).replaceAll('-', '_');
}

/**
 * Parse a strict, dependency-free command line.
 * Specs use `{ type: 'string'|'integer'|'boolean', multiple?, min?, max?, default? }`.
 */
export function parseBoardGateArgs(argv, specs) {
  const values = {};
  const seen = new Set();
  for (const [name, spec] of Object.entries(specs)) {
    if ('default' in spec) values[name] = structuredClone(spec.default);
    else if (spec.multiple) values[name] = [];
    else if (spec.type === 'boolean') values[name] = false;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--') || token === '--') {
      throw new BoardGateError(`Unexpected positional argument: ${token}`, 'usage', BOARD_GATE_EXIT.usage);
    }
    const equals = token.indexOf('=');
    const rawName = equals === -1 ? token : token.slice(0, equals);
    const name = optionName(rawName);
    const spec = specs[name];
    if (!spec) {
      throw new BoardGateError(`Unknown option: ${rawName}`, 'usage', BOARD_GATE_EXIT.usage);
    }
    if (spec.type === 'boolean') {
      if (equals !== -1) {
        throw new BoardGateError(`${rawName} does not accept a value`, 'usage', BOARD_GATE_EXIT.usage);
      }
      values[name] = true;
      seen.add(name);
      continue;
    }
    const rawValue = equals === -1 ? argv[++index] : token.slice(equals + 1);
    if (rawValue == null || rawValue.startsWith('--') || rawValue === '') {
      throw new BoardGateError(`${rawName} requires a value`, 'usage', BOARD_GATE_EXIT.usage);
    }
    let value = rawValue;
    if (spec.type === 'integer') {
      value = Number(rawValue);
      if (!Number.isSafeInteger(value)) {
        throw new BoardGateError(`${rawName} must be an integer`, 'usage', BOARD_GATE_EXIT.usage);
      }
      if (spec.min != null && value < spec.min) {
        throw new BoardGateError(`${rawName} must be at least ${spec.min}`, 'usage', BOARD_GATE_EXIT.usage);
      }
      if (spec.max != null && value > spec.max) {
        throw new BoardGateError(`${rawName} must be at most ${spec.max}`, 'usage', BOARD_GATE_EXIT.usage);
      }
    }
    if (spec.multiple) values[name].push(value);
    else if (seen.has(name)) {
      throw new BoardGateError(`${rawName} may only be specified once`, 'usage', BOARD_GATE_EXIT.usage);
    } else values[name] = value;
    seen.add(name);
  }
  return values;
}

export async function resolveCatalogScenarios(requested = []) {
  const { getBoardScenario, listBoardScenarioMetadata } = await importTsModule(
    '../../../src/dev/orchestrate-scenarios/index.ts',
  );
  const ids = requested.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
  const selected = ids.length ? ids : listBoardScenarioMetadata().map((entry) => entry.id);
  const unique = [...new Set(selected)];
  return unique.map((id) => {
    const scenario = getBoardScenario(id);
    if (!scenario) {
      throw new BoardGateError(`Unknown board scenario: ${id}`, 'usage', BOARD_GATE_EXIT.usage);
    }
    return scenario;
  });
}

export function deterministicGateSeed(scenarioSeed, baseSeed) {
  const value = `${scenarioSeed}:gate:${baseSeed}`;
  let state = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  state = (state + 0x6d2b79f5) >>> 0;
  let mixed = state;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return (mixed ^ (mixed >>> 14)) >>> 0;
}

export async function loadBoardGateAdapter(adapterPath, gate) {
  const requested = adapterPath || process.env.MINNOW_BOARD_GATE_ADAPTER;
  if (!requested) {
    throw new BoardGateError(
      `${gate} gate is unsupported: set --adapter or MINNOW_BOARD_GATE_ADAPTER to a real board harness`,
      'unsupported',
      BOARD_GATE_EXIT.unsupported,
    );
  }
  const absolute = path.resolve(requested);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error('path is not a file');
  } catch (error) {
    throw new BoardGateError(
      `${gate} gate adapter is unavailable at ${absolute}: ${error.message}`,
      'unsupported',
      BOARD_GATE_EXIT.unsupported,
    );
  }
  let module;
  try {
    module = await import(pathToFileURL(absolute).href);
  } catch (error) {
    throw new BoardGateError(
      `${gate} gate adapter could not be loaded: ${error.message}`,
      'unsupported',
      BOARD_GATE_EXIT.unsupported,
    );
  }
  if (typeof module.createBoardGateDriver !== 'function') {
    throw new BoardGateError(
      `${gate} gate adapter must export createBoardGateDriver(context)`,
      'unsupported',
      BOARD_GATE_EXIT.unsupported,
    );
  }
  return module.createBoardGateDriver;
}

const PASSING = new Set(['pass', 'expected_blocked']);

export function exitCodeForClassification(classification) {
  if (PASSING.has(classification)) return BOARD_GATE_EXIT.success;
  if (classification === 'timeout') return BOARD_GATE_EXIT.timeout;
  if (classification === 'harness_error' || classification === 'stopped') {
    return BOARD_GATE_EXIT.harnessError;
  }
  return BOARD_GATE_EXIT.gateFailure;
}

async function waitForTerminal(manager, runId, timeoutMs) {
  const deadline = Date.now() + timeoutMs + 5_000;
  while (Date.now() < deadline) {
    const run = await manager.status(runId);
    if (run && (run.status === 'completed' || run.status === 'stopped')) return run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new BoardGateError(`Scenario manager did not settle run ${runId}`, 'timeout', BOARD_GATE_EXIT.timeout);
}

export async function runManagedBoardGate({
  gate,
  scenarios,
  adapter,
  iterations,
  timeoutMs,
  baseSeed,
  checkpoints = [],
  adapterContext = {},
}) {
  let exitCode = BOARD_GATE_EXIT.success;
  const runs = [];
  for (const scenario of scenarios) {
    const scenarioInput = {
      ...scenario,
      gate: { kind: gate, checkpoints: [...checkpoints] },
    };
    const driver = await adapter({
      gate,
      scenario: structuredClone(scenario),
      checkpoints: [...checkpoints],
      ...structuredClone(adapterContext),
    });
    if (!driver || (typeof driver !== 'function' && typeof driver.runIteration !== 'function')) {
      throw new BoardGateError(
        `${gate} gate adapter did not provide a ScenarioRunManager driver`,
        'unsupported',
        BOARD_GATE_EXIT.unsupported,
      );
    }
    const manager = new ScenarioRunManager({ driver });
    const prepared = await manager.prepare({
      scenario: scenarioInput,
      iterations,
      timeoutMs,
      seed: deterministicGateSeed(scenario.seed, baseSeed),
      failFast: true,
    });
    await manager.start(prepared.id);
    const terminal = await waitForTerminal(manager, prepared.id, timeoutMs * iterations);
    const runExit = exitCodeForClassification(terminal.classification);
    if (runExit !== BOARD_GATE_EXIT.success && exitCode === BOARD_GATE_EXIT.success) exitCode = runExit;
    runs.push({
      runId: terminal.id,
      scenarioId: scenario.id,
      classification: terminal.classification,
      summary: terminal.summary,
    });
  }
  return { gate, exitCode, runs };
}

export function printGateResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function runBoardGateMain(action) {
  try {
    const result = await action();
    const exitCode = result?.exitCode ?? BOARD_GATE_EXIT.success;
    if (result) {
      await new Promise((resolve) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, resolve);
      });
    }
    process.exit(exitCode);
  } catch (error) {
    const normalized =
      error instanceof BoardGateError
        ? error
        : new BoardGateError(error instanceof Error ? error.message : String(error));
    await new Promise((resolve) => {
      process.stderr.write(
        `${JSON.stringify({
          ok: false,
          classification: normalized.classification,
          error: normalized.message,
        })}\n`,
        resolve,
      );
    });
    process.exit(normalized.exitCode);
  }
}

export function isMain(metaUrl) {
  return process.argv[1] != null && pathToFileURL(path.resolve(process.argv[1])).href === metaUrl;
}
