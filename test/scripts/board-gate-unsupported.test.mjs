import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { promisify } from 'node:util';
import { BOARD_GATE_EXIT } from '../../scripts/run-board-cli.mjs';
import { DEFAULT_PERSISTED_GATE_ADAPTER } from '../../scripts/run-board-gate-command.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');

async function runScript(name, args = [], env = process.env) {
  try {
    const result = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', path.join(root, 'scripts', name), ...args],
      { cwd: root, env },
    );
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

describe('board gate adapter errors', () => {
  let temporary;
  let packagePath;

  before(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-board-unsupported-'));
    packagePath = path.join(temporary, 'Minnow');
    await fs.mkdir(packagePath);
  });

  after(async () => {
    await fs.rm(temporary, { recursive: true, force: true });
  });

  test('persisted gates ship a default executable adapter', async () => {
    const stat = await fs.stat(DEFAULT_PERSISTED_GATE_ADAPTER);
    assert.equal(stat.isFile(), true);
    const adapter = await import(pathToFileURL(DEFAULT_PERSISTED_GATE_ADAPTER).href);
    assert.equal(typeof adapter.createBoardGateDriver, 'function');
  });

  test('Electron smoke is explicitly unsupported without a GUI driver', async () => {
    const result = await runScript(
      'run-board-electron-smoke.mjs',
      ['--package-path', packagePath],
      { ...process.env, MINNOW_BOARD_GATE_ADAPTER: '' },
    );
    assert.equal(result.code, BOARD_GATE_EXIT.unsupported);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.classification, 'unsupported');
    assert.match(payload.error, /real board harness/);
  });

  test('an adapter module without the driver contract is unsupported', async () => {
    const adapter = path.join(temporary, 'invalid-adapter.mjs');
    await fs.writeFile(adapter, 'export const available = true;\n');
    const result = await runScript('run-board-persisted.mjs', ['--adapter', adapter]);
    assert.equal(result.code, BOARD_GATE_EXIT.unsupported);
    assert.match(result.stderr, /must export createBoardGateDriver/);
  });

  test('a real adapter runs through ScenarioRunManager with deterministic iteration seeds', async () => {
    const adapter = path.join(temporary, 'passing-adapter.mjs');
    const home = path.join(temporary, 'home');
    await fs.writeFile(
      adapter,
      `export function createBoardGateDriver() {
        return ({ seed }) => ({ classification: 'pass', finalState: { seed } });
      }\n`,
    );
    const result = await runScript(
      'run-board-persisted.mjs',
      [
        '--adapter',
        adapter,
        '--scenario',
        'happy.quick',
        '--iterations',
        '2',
        '--seed',
        '123',
      ],
      { ...process.env, MINNOW_HOME: home },
    );
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.runs[0].classification, 'pass');
    assert.deepEqual(payload.runs[0].summary, { completed: 2, passed: 2, failed: 0 });

    const runId = payload.runs[0].runId;
    const rows = (await fs.readFile(
      path.join(home, 'logs', 'orchestrate-scenarios', runId, 'iterations.jsonl'),
      'utf8',
    ))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].seed, rows[1].seed);
  });
});
