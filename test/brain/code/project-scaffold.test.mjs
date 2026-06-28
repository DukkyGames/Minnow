/**
 * Brain index project scaffold — jsconfig for JS/TS workspaces without tsconfig.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  BRAIN_JS_CONFIG_MARKER,
  BRAIN_JS_CONFIG_REL,
  buildBrainJsConfig,
  ensureBrainIndexProjectConfig,
  workspaceHasJsTsSources,
  workspaceHasTypeScriptProjectConfig,
} from '../../../server/brain/code/project-scaffold.js';

describe('brain index project scaffold', () => {
  /** @type {string} */
  let tempRoot;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-scaffold-'));
  });

  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test('buildBrainJsConfig includes parent include paths and marker', () => {
    const body = buildBrainJsConfig();
    assert.ok(BRAIN_JS_CONFIG_MARKER in body);
    assert.deepEqual(body.include, ['../**/*']);
    assert.equal(body.compilerOptions.noEmit, true);
  });

  test('creates .minnow/jsconfig.json when JS exists and no project config', async () => {
    const root = path.join(tempRoot, 'plain-js');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'app.js'), 'export function hello() {}\n', 'utf8');

    assert.equal(await workspaceHasJsTsSources(root), true);
    assert.equal(await workspaceHasTypeScriptProjectConfig(root), false);

    const result = await ensureBrainIndexProjectConfig(root);
    assert.equal(result.created, true);
    assert.equal(result.path, BRAIN_JS_CONFIG_REL);

    const raw = await fs.readFile(path.join(root, BRAIN_JS_CONFIG_REL), 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(BRAIN_JS_CONFIG_MARKER in parsed);
  });

  test('skips when tsconfig.json already exists', async () => {
    const root = path.join(tempRoot, 'has-tsconfig');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'index.ts'), 'export const x = 1;\n', 'utf8');
    await fs.writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{}}\n', 'utf8');

    const result = await ensureBrainIndexProjectConfig(root);
    assert.equal(result.created, false);
    assert.equal(result.reason, 'project-config-exists');
  });

  test('skips when auto scaffold disabled', async () => {
    const root = path.join(tempRoot, 'disabled');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'index.js'), 'export const x = 1;\n', 'utf8');

    const result = await ensureBrainIndexProjectConfig(root, { enabled: false });
    assert.equal(result.created, false);
    assert.equal(result.reason, 'disabled');
  });

  test('does not overwrite custom .minnow/jsconfig.json', async () => {
    const root = path.join(tempRoot, 'custom-scaffold');
    const minnowDir = path.join(root, '.minnow');
    await fs.mkdir(minnowDir, { recursive: true });
    await fs.writeFile(path.join(root, 'main.ts'), 'export const y = 2;\n', 'utf8');
    await fs.writeFile(
      path.join(minnowDir, 'jsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
      'utf8',
    );

    const result = await ensureBrainIndexProjectConfig(root);
    assert.equal(result.created, false);
    assert.equal(result.reason, 'custom-file-present');
  });

  test('migrates legacy .minnow/brain-jsconfig.json to jsconfig.json', async () => {
    const root = path.join(tempRoot, 'legacy-migrate');
    const minnowDir = path.join(root, '.minnow');
    await fs.mkdir(minnowDir, { recursive: true });
    await fs.writeFile(path.join(root, 'app.js'), 'export function legacy() {}\n', 'utf8');
    const legacyBody = buildBrainJsConfig();
    await fs.writeFile(
      path.join(minnowDir, 'brain-jsconfig.json'),
      `${JSON.stringify(legacyBody, null, 2)}\n`,
      'utf8',
    );

    const result = await ensureBrainIndexProjectConfig(root);
    assert.equal(result.created, true);
    assert.equal(result.migrated, true);
    assert.equal(result.path, BRAIN_JS_CONFIG_REL);

    await assert.rejects(() => fs.access(path.join(minnowDir, 'brain-jsconfig.json')));
    const migrated = JSON.parse(await fs.readFile(path.join(root, BRAIN_JS_CONFIG_REL), 'utf8'));
    assert.ok(BRAIN_JS_CONFIG_MARKER in migrated);
  });
});
