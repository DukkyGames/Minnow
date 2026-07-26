import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  augmentConcurrentlyQuotedSegments,
  augmentDevServerCommand,
  buildDevServerSpawnEnv,
  expandPackageDevScript,
  isSplitStackDevCommand,
  resolveEffectiveGuide,
  rewriteHealthUrlForProbe,
} from '../../server/dev-server/effective-guide.js';

describe('effective dev-server guide', () => {
  /** @type {string} */
  let tempDir;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-effective-guide-'));
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('rewriteHealthUrlForProbe keeps localhost and updates port', () => {
    const url = rewriteHealthUrlForProbe('http://localhost:3000/', 5173);
    assert.equal(url, 'http://127.0.0.1:5173/');
  });

  test('augmentDevServerCommand appends vite flags for npm run dev', () => {
    const cmd = augmentDevServerCommand('npm run dev', 4000, 'lan');
    assert.equal(cmd, 'npm run dev -- --port 4000 --host');
  });

  test('resolveEffectiveGuide uses settings port and network', () => {
    const effective = resolveEffectiveGuide(
      {
        command: 'npm run dev',
        healthUrl: 'http://localhost:5173/',
        port: 5173,
      },
      { port: 4000, network: 'lan' },
    );
    assert.equal(effective.port, 4000);
    assert.equal(effective.network, 'lan');
    assert.equal(effective.bindHost, '0.0.0.0');
    assert.equal(effective.healthUrl, 'http://127.0.0.1:4000/');
    assert.match(effective.command, /--port 4000/);
    assert.match(effective.command, /--host/);
  });

  test('buildDevServerSpawnEnv sets HOST for lan', () => {
    const env = buildDevServerSpawnEnv(5173, 'lan');
    assert.equal(env.PORT, '5173');
    assert.equal(env.HOST, '0.0.0.0');
  });

  test('isSplitStackDevCommand detects concurrently', () => {
    assert.equal(
      isSplitStackDevCommand('concurrently "npm run dev:server" "npm run dev:client"'),
      true,
    );
    assert.equal(isSplitStackDevCommand('npm run dev'), false);
  });

  test('augmentConcurrentlyQuotedSegments injects port into client child only', () => {
    const input =
      'npx concurrently "npm run dev:server" "npm run dev:client"';
    const output = augmentConcurrentlyQuotedSegments(input, 3000, 'local');
    assert.equal(
      output,
      'npx concurrently "npm run dev:server" "npm run dev:client -- --port 3000"',
    );
  });

  test('expandPackageDevScript expands npm run dev when package.json uses concurrently', async () => {
    const dir = path.join(tempDir, 'split-stack');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        scripts: {
          dev: 'concurrently "npm run dev:server" "npm run dev:client"',
          'dev:server': 'node server.js',
          'dev:client': 'vite',
        },
      }),
      'utf8',
    );

    const expanded = expandPackageDevScript('npm run dev', dir);
    assert.equal(
      expanded,
      'npx concurrently "npm run dev:server" "npm run dev:client"',
    );
  });

  test('resolveEffectiveGuide augments split-stack npm run dev from package.json', async () => {
    const dir = path.join(tempDir, 'split-stack-resolve');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        scripts: {
          dev: 'concurrently "npm run dev:server" "npm run dev:client"',
          'dev:server': 'node server.js',
          'dev:client': 'vite',
        },
      }),
      'utf8',
    );

    const effective = resolveEffectiveGuide(
      { command: 'npm run dev' },
      { port: 3000, network: 'local' },
      { packageJsonDir: dir },
    );

    assert.equal(effective.splitStack, true);
    assert.equal(effective.port, 3000);
    assert.equal(effective.apiPort, 3001);
    assert.equal(effective.healthUrl, 'http://127.0.0.1:3000/');
    assert.equal(
      effective.command,
      'npx concurrently "npm run dev:server" "npm run dev:client -- --port 3000"',
    );

    const env = buildDevServerSpawnEnv(effective.port, effective.network, {
      splitStack: effective.splitStack,
      apiPort: effective.apiPort,
    });
    assert.equal(env.PORT, '3001');
  });

  test('resolveEffectiveGuide honors apiPort from startup guide', async () => {
    const dir = path.join(tempDir, 'split-stack-api-port');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        scripts: {
          dev: 'concurrently "npm run dev:server" "npm run dev:client"',
        },
      }),
      'utf8',
    );

    const effective = resolveEffectiveGuide(
      { command: 'npm run dev', apiPort: 3002 },
      { port: 3000, network: 'local' },
      { packageJsonDir: dir },
    );

    assert.equal(effective.apiPort, 3002);
    const env = buildDevServerSpawnEnv(effective.port, effective.network, {
      splitStack: effective.splitStack,
      apiPort: effective.apiPort,
    });
    assert.equal(env.PORT, '3002');
  });
});
