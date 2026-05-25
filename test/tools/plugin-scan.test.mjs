import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanPluginDir } from '../../server/tools/scan.js';
import { validateToolManifest } from '../../server/tools/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, '../fixtures/plugin-tools');

describe('plugin scan', () => {
  test('valid echo fixture scans successfully', async () => {
    const items = await scanPluginDir(FIXTURE_ROOT);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'echo');
    assert.equal(items[0].namespacedName, 'plugin__echo__ping');
  });

  test('rejects id mismatch with folder', () => {
    assert.throws(
      () => validateToolManifest({ id: 'wrong', functionName: 'ping', label: 'X', description: 'Y', category: 'utility', parameters: { type: 'object', properties: {} } }, 'echo'),
      /must match folder/,
    );
  });

  test('rejects reserved built-in id', async () => {
    const tmp = path.join(os.tmpdir(), `minnow-plugin-scan-${process.pid}`);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(path.join(tmp, 'read_file'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'read_file', 'tool.json'),
      JSON.stringify({
        id: 'read_file',
        functionName: 'ping',
        label: 'Bad',
        description: 'Bad',
        category: 'files',
        parameters: { type: 'object', properties: {} },
      }),
      'utf8',
    );
    await fs.writeFile(path.join(tmp, 'read_file', 'handler.mjs'), 'export default async function handler() { return "x"; }\n', 'utf8');

    const items = await scanPluginDir(tmp);
    assert.equal(items.length, 0);

    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('skips directories starting with underscore', async () => {
    const tmp = path.join(os.tmpdir(), `minnow-plugin-scan-us-${process.pid}`);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(path.join(tmp, '_template'), { recursive: true });
    await fs.writeFile(path.join(tmp, '_template', 'tool.json'), '{}', 'utf8');

    const items = await scanPluginDir(tmp);
    assert.equal(items.length, 0);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
