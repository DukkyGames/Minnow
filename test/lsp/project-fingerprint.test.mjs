/**
 * TypeScript project fingerprint — tsconfig / @types/node changes must miss
 * the get_lsp_diagnostics snapshot (MIN-616).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
  hashTypeScriptProjectFingerprint,
  isTypeScriptProjectConfigName,
} from '../../server/lsp/project-fingerprint.js';

describe('TypeScript project fingerprint', () => {
  /** @type {string[]} */
  const tempDirs = [];

  after(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  test('recognizes Vite and solution-style tsconfig names', () => {
    assert.equal(isTypeScriptProjectConfigName('tsconfig.json'), true);
    assert.equal(isTypeScriptProjectConfigName('tsconfig.app.json'), true);
    assert.equal(isTypeScriptProjectConfigName('tsconfig.node.json'), true);
    assert.equal(isTypeScriptProjectConfigName('jsconfig.json'), true);
    assert.equal(isTypeScriptProjectConfigName('package.json'), true);
    assert.equal(isTypeScriptProjectConfigName('vite.config.ts'), false);
  });

  test('changes when tsconfig.node.json is added', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mn-fp-tsconfig-'));
    tempDirs.push(root);
    await fs.writeFile(
      path.join(root, 'vite.config.ts'),
      'export default { server: { port: 5173 } };\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
      'utf8',
    );

    const before = await hashTypeScriptProjectFingerprint('vite.config.ts', root);
    await fs.writeFile(
      path.join(root, 'tsconfig.node.json'),
      JSON.stringify({
        compilerOptions: { types: ['node'], noEmit: true },
        include: ['vite.config.ts'],
      }),
      'utf8',
    );
    const after = await hashTypeScriptProjectFingerprint('vite.config.ts', root);
    assert.notEqual(after, before);
  });

  test('changes when @types/node appears under node_modules', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mn-fp-types-'));
    tempDirs.push(root);
    await fs.writeFile(
      path.join(root, 'vite.config.ts'),
      'export default { server: { port: Number(process.env.VITE_PORT) } };\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(root, 'tsconfig.node.json'),
      JSON.stringify({
        compilerOptions: { types: ['node'], noEmit: true },
        include: ['vite.config.ts'],
      }),
      'utf8',
    );

    const before = await hashTypeScriptProjectFingerprint('vite.config.ts', root);
    await fs.mkdir(path.join(root, 'node_modules/@types/node'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'node_modules/@types/node', 'index.d.ts'),
      'export {};\n',
      'utf8',
    );
    const after = await hashTypeScriptProjectFingerprint('vite.config.ts', root);
    assert.notEqual(after, before);
  });

  test('is stable when neither configs nor types change', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mn-fp-stable-'));
    tempDirs.push(root);
    await fs.writeFile(path.join(root, 'app.ts'), 'export const n = 1;\n', 'utf8');
    await fs.writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true }, include: ['app.ts'] }),
      'utf8',
    );
    const first = await hashTypeScriptProjectFingerprint('app.ts', root);
    const second = await hashTypeScriptProjectFingerprint('app.ts', root);
    assert.equal(second, first);
  });
});
