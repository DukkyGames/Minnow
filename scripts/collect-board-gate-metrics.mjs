import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../server/config/home.js';
import {
  BOARD_GATE_EXIT,
  BoardGateError,
  isMain,
  parseBoardGateArgs,
  runBoardGateMain,
} from './run-board-cli.mjs';

const DEFAULT_MAX_FILE_BYTES = 2_000_000;
const DEFAULT_MAX_TOTAL_BYTES = 50_000_000;
const DEFAULT_MAX_RUNS = 10_000;

async function readCapped(filePath, state) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new BoardGateError(`Artifact is not a file: ${filePath}`, 'usage', BOARD_GATE_EXIT.usage);
  if (stat.size > state.maxFileBytes) {
    throw new BoardGateError(
      `Artifact exceeds ${state.maxFileBytes} byte cap: ${filePath}`,
      'artifact_too_large',
      BOARD_GATE_EXIT.usage,
    );
  }
  state.totalBytes += stat.size;
  if (state.totalBytes > state.maxTotalBytes) {
    throw new BoardGateError(
      `Artifacts exceed ${state.maxTotalBytes} aggregate byte cap`,
      'artifact_too_large',
      BOARD_GATE_EXIT.usage,
    );
  }
  return fs.readFile(filePath, 'utf8');
}

async function discoverRunDirectories(inputs, maxRuns) {
  const runs = new Set();
  for (const input of inputs) {
    const absolute = path.resolve(input);
    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch (error) {
      throw new BoardGateError(`Metrics input is unavailable: ${absolute}: ${error.message}`, 'usage', BOARD_GATE_EXIT.usage);
    }
    if (stat.isSymbolicLink()) {
      throw new BoardGateError(`Metrics input must not be a symbolic link: ${absolute}`, 'usage', BOARD_GATE_EXIT.usage);
    }
    if (stat.isFile()) {
      if (path.basename(absolute) !== 'iterations.jsonl') {
        throw new BoardGateError(`Metrics file must be named iterations.jsonl: ${absolute}`, 'usage', BOARD_GATE_EXIT.usage);
      }
      runs.add(path.dirname(absolute));
      if (runs.size > maxRuns) {
        throw new BoardGateError(`Metrics input exceeds ${maxRuns} run cap`, 'artifact_too_large', BOARD_GATE_EXIT.usage);
      }
      continue;
    }
    if (!stat.isDirectory()) {
      throw new BoardGateError(`Metrics input is not a directory: ${absolute}`, 'usage', BOARD_GATE_EXIT.usage);
    }
    let isDirectRun = false;
    try {
      isDirectRun = (await fs.stat(path.join(absolute, 'iterations.jsonl'))).isFile();
    } catch {
      // Treat this as a root containing run directories.
    }
    if (isDirectRun) {
      runs.add(absolute);
      if (runs.size > maxRuns) {
        throw new BoardGateError(`Metrics input exceeds ${maxRuns} run cap`, 'artifact_too_large', BOARD_GATE_EXIT.usage);
      }
      continue;
    }
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const runDir = path.join(absolute, entry.name);
      try {
        if ((await fs.stat(path.join(runDir, 'iterations.jsonl'))).isFile()) runs.add(runDir);
      } catch {
        // Ignore non-run directories in an artifact root.
      }
      if (runs.size > maxRuns) {
        throw new BoardGateError(`Metrics input exceeds ${maxRuns} run cap`, 'artifact_too_large', BOARD_GATE_EXIT.usage);
      }
    }
  }
  return [...runs].sort();
}

function finiteCount(...values) {
  for (const value of values) {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

function rowClassification(row) {
  const value = row.classification ?? row.outcome;
  return typeof value === 'string' ? value : 'harness_error';
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function collectBoardGateMetrics({
  inputs,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxRuns = DEFAULT_MAX_RUNS,
}) {
  const state = { maxFileBytes, maxTotalBytes, totalBytes: 0 };
  const runDirectories = await discoverRunDirectories(inputs, maxRuns);
  const classifications = {};
  const retryDistribution = {};
  const recoveryRounds = [];
  let iterations = 0;
  let converged = 0;
  let timeoutCount = 0;
  let unexpectedQuarantineCount = 0;
  let iterationsWithUnexpectedQuarantine = 0;

  for (const runDir of runDirectories) {
    const text = await readCapped(path.join(runDir, 'iterations.jsonl'), state);
    for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new BoardGateError(
          `Malformed JSONL at ${path.join(runDir, 'iterations.jsonl')}:${lineIndex + 1}`,
          'artifact_invalid',
          BOARD_GATE_EXIT.usage,
        );
      }
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new BoardGateError(
          `Iteration record must be an object at ${runDir}:${lineIndex + 1}`,
          'artifact_invalid',
          BOARD_GATE_EXIT.usage,
        );
      }
      iterations += 1;
      const classification = rowClassification(row);
      classifications[classification] = (classifications[classification] ?? 0) + 1;
      if (classification === 'pass' || classification === 'passed' || classification === 'expected_blocked') {
        converged += 1;
      }
      if (classification === 'timeout') timeoutCount += 1;

      const metrics = row.metrics && typeof row.metrics === 'object' ? row.metrics : {};
      const quarantines = finiteCount(
        metrics.unexpectedQuarantineCount,
        metrics.unexpectedQuarantines,
        row.unexpectedQuarantineCount,
        row.unexpectedQuarantines,
      );
      unexpectedQuarantineCount += quarantines;
      if (quarantines > 0) iterationsWithUnexpectedQuarantine += 1;

      const retries = finiteCount(metrics.retryCount, metrics.retries, row.retryCount, row.retries);
      retryDistribution[String(retries)] = (retryDistribution[String(retries)] ?? 0) + 1;
      const rounds = finiteCount(metrics.recoveryRounds, row.recoveryRounds);
      recoveryRounds.push(rounds);
    }
  }

  const rate = (numerator) => (iterations === 0 ? 0 : numerator / iterations);
  return {
    schemaVersion: 1,
    runs: runDirectories.length,
    iterations,
    convergenceRate: rate(converged),
    unexpectedQuarantineRate: rate(iterationsWithUnexpectedQuarantine),
    unexpectedQuarantineCount,
    timeoutRate: rate(timeoutCount),
    medianRecoveryRounds: median(recoveryRounds),
    retryDistribution: Object.fromEntries(
      Object.entries(retryDistribution).sort(([left], [right]) => Number(left) - Number(right)),
    ),
    classifications: Object.fromEntries(
      Object.entries(classifications).sort(([left], [right]) => left.localeCompare(right)),
    ),
    artifactBytesRead: state.totalBytes,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseBoardGateArgs(argv, {
    input: { type: 'string', multiple: true },
    output: { type: 'string' },
    max_file_bytes: { type: 'integer', min: 1, default: DEFAULT_MAX_FILE_BYTES },
    max_total_bytes: { type: 'integer', min: 1, default: DEFAULT_MAX_TOTAL_BYTES },
    max_runs: { type: 'integer', min: 1, default: DEFAULT_MAX_RUNS },
    fail_on_unexpected: { type: 'boolean' },
    help: { type: 'boolean' },
  });
  if (args.help) {
    return {
      gate: 'metrics',
      exitCode: BOARD_GATE_EXIT.success,
      usage: 'node scripts/collect-board-gate-metrics.mjs [--input <artifact-root>] [--output <file>] [--fail-on-unexpected]',
    };
  }
  const inputs = args.input.length
    ? args.input
    : [path.join(getMinnowHome(), 'logs', 'orchestrate-scenarios')];
  const metrics = await collectBoardGateMetrics({
    inputs,
    maxFileBytes: args.max_file_bytes,
    maxTotalBytes: args.max_total_bytes,
    maxRuns: args.max_runs,
  });
  const unexpected =
    (metrics.classifications.harness_error ?? 0) +
    (metrics.classifications.product_failure ?? 0) +
    (metrics.classifications.unexpected_blocked ?? 0) +
    (metrics.classifications.timeout ?? 0) +
    metrics.unexpectedQuarantineCount;
  const result = {
    gate: 'metrics',
    classification: unexpected > 0 ? 'product_failure' : 'pass',
    exitCode: args.fail_on_unexpected && unexpected > 0
      ? BOARD_GATE_EXIT.gateFailure
      : BOARD_GATE_EXIT.success,
    metrics,
  };
  if (args.output) {
    const output = path.resolve(args.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  return result;
}

if (isMain(import.meta.url)) {
  await runBoardGateMain(() => main());
}
