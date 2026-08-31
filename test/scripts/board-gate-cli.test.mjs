import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';
import { parseBoardGateArgs } from '../../scripts/run-board-cli.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');

async function runScript(name, args = []) {
  try {
    const result = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', path.join(root, 'scripts', name), ...args],
      { cwd: root },
    );
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

describe('board scenario-contract command line', () => {
  test('strictly validates names, values, multiplicity, and integer bounds', () => {
    const specs = {
      scenario: { type: 'string', multiple: true },
      iterations: { type: 'integer', min: 1, max: 100, default: 1 },
      verbose: { type: 'boolean' },
    };
    assert.deepEqual(
      parseBoardGateArgs(
        ['--scenario', 'happy.quick', '--scenario=happy.smoke', '--iterations', '10', '--verbose'],
        specs,
      ),
      {
        scenario: ['happy.quick', 'happy.smoke'],
        iterations: 10,
        verbose: true,
      },
    );
    assert.throws(() => parseBoardGateArgs(['positional'], specs), /Unexpected positional/);
    assert.throws(() => parseBoardGateArgs(['--unknown'], specs), /Unknown option/);
    assert.throws(() => parseBoardGateArgs(['--iterations', '0'], specs), /at least 1/);
    assert.throws(() => parseBoardGateArgs(['--iterations', 'one'], specs), /must be an integer/);
    assert.throws(
      () => parseBoardGateArgs(['--iterations', '2', '--iterations', '3'], specs),
      /only be specified once/,
    );
  });

  test('scenario contract command validates the current catalog', async () => {
    const result = await runScript('run-board-scenario-contract.mjs');
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.classification, 'pass');
    assert.ok(payload.scenarioCount > 0);
  });
});
