import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  augmentConcurrentlyQuotedSegments,
  augmentDevServerCommand,
  buildDevServerSpawnEnv,
  detectDevServerStack,
  expandPackageDevScript,
  isSplitStackDevCommand,
  readPackageScriptBody,
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

  test('detectDevServerStack does not treat npm run dev as Vite by itself', () => {
    assert.equal(detectDevServerStack({ command: 'npm run dev' }), 'unknown');
    assert.equal(
      detectDevServerStack({ command: 'npm run dev', scriptBody: 'vite' }),
      'vite',
    );
    assert.equal(
      detectDevServerStack({ command: 'npm run dev', scriptBody: 'electron-vite dev' }),
      'electron-vite',
    );
    assert.equal(
      detectDevServerStack({ command: 'npm run dev', scriptBody: 'next dev' }),
      'next',
    );
    assert.equal(
      detectDevServerStack({ command: 'npm run dev', scriptBody: 'react-scripts start' }),
      'cra',
    );
    assert.equal(
      detectDevServerStack({
        command: 'npm run dev',
        scriptBody: 'concurrently "npm run dev:server" "npm run dev:client"',
      }),
      'split-stack',
    );
  });

  test('augmentDevServerCommand appends vite flags when the stack is Vite', () => {
    const cmd = augmentDevServerCommand('npm run dev', 4000, 'lan', {
      scriptBody: 'vite',
    });
    assert.equal(cmd, 'npm run dev -- --port 4000 --host');
  });

  test('augmentDevServerCommand appends vite flags to a bare vite command', () => {
    const cmd = augmentDevServerCommand('npx vite', 4000, 'local');
    assert.equal(cmd, 'npx vite --port 4000');
  });

  test('augmentDevServerCommand does not inject Vite flags for unknown npm run dev', () => {
    const cmd = augmentDevServerCommand('npm run dev', 4000, 'lan');
    assert.equal(cmd, 'npm run dev');
  });

  test('augmentDevServerCommand injects Next -p and skips Vite --port', () => {
    const cmd = augmentDevServerCommand('npm run dev', 4000, 'local', {
      scriptBody: 'next dev',
    });
    assert.equal(cmd, 'npm run dev -- -p 4000');
    assert.equal(cmd.includes('--port'), false);
  });

  test('augmentDevServerCommand skips Next -p when already present', () => {
    const cmd = augmentDevServerCommand('next dev -p 3000', 4000, 'local');
    assert.equal(cmd, 'next dev -p 3000');
  });

  test('augmentDevServerCommand does not inject CLI flags for electron-vite', () => {
    const cmd = augmentDevServerCommand('npm run dev', 4000, 'lan', {
      scriptBody: 'electron-vite dev',
    });
    assert.equal(cmd, 'npm run dev');
  });

  test('resolveEffectiveGuide uses settings port and network for a Vite script', async () => {
    const dir = path.join(tempDir, 'vite-settings');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite' } }),
      'utf8',
    );

    const effective = resolveEffectiveGuide(
      {
        command: 'npm run dev',
        healthUrl: 'http://localhost:5173/',
        port: 5173,
      },
      { port: 4000, network: 'lan' },
      { packageJsonDir: dir },
    );
    assert.equal(effective.port, 4000);
    assert.equal(effective.network, 'lan');
    assert.equal(effective.bindHost, '0.0.0.0');
    assert.equal(effective.stack, 'vite');
    assert.equal(effective.healthUrl, 'http://127.0.0.1:4000/');
    assert.match(effective.command, /--port 4000/);
    assert.match(effective.command, /--host/);
  });

  test('buildDevServerSpawnEnv sets HOST and VITE_PORT for lan', () => {
    const env = buildDevServerSpawnEnv(5173, 'lan');
    assert.equal(env.PORT, '5173');
    assert.equal(env.VITE_PORT, '5173');
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

  test('augmentConcurrentlyQuotedSegments does not inject --port into electron-vite children', () => {
    const input = 'npx concurrently "npm run dev:server" "electron-vite dev"';
    const output = augmentConcurrentlyQuotedSegments(input, 3000, 'local');
    assert.equal(output, input);
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
    assert.equal(
      readPackageScriptBody('npm run dev', dir),
      'concurrently "npm run dev:server" "npm run dev:client"',
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
    assert.equal(effective.stack, 'split-stack');
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
    assert.equal(env.VITE_PORT, '3000');
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
    assert.equal(env.VITE_PORT, '3000');
  });

  test('resolveEffectiveGuide injects Vite --port when package.json script is vite', async () => {
    const dir = path.join(tempDir, 'vite-script');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite' } }),
      'utf8',
    );

    const effective = resolveEffectiveGuide(
      { command: 'npm run dev' },
      { port: 5174, network: 'local' },
      { packageJsonDir: dir },
    );

    assert.equal(effective.stack, 'vite');
    assert.equal(effective.command, 'npm run dev -- --port 5174');
    const env = buildDevServerSpawnEnv(effective.port, effective.network);
    assert.equal(env.PORT, '5174');
    assert.equal(env.VITE_PORT, '5174');
  });

  test('resolveEffectiveGuide does not inject --port for electron-vite and sets VITE_PORT', async () => {
    const dir = path.join(tempDir, 'electron-vite-script');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'electron-vite dev' } }),
      'utf8',
    );

    const effective = resolveEffectiveGuide(
      { command: 'npm run dev' },
      { port: 3000, network: 'local' },
      { packageJsonDir: dir },
    );

    assert.equal(effective.stack, 'electron-vite');
    assert.equal(effective.command, 'npm run dev');
    assert.equal(effective.command.includes('--port'), false);

    const env = buildDevServerSpawnEnv(effective.port, effective.network);
    assert.equal(env.PORT, '3000');
    assert.equal(env.VITE_PORT, '3000');
    assert.equal(env.HOST, '127.0.0.1');
  });

  test('resolveEffectiveGuide injects Next -p for next dev scripts', async () => {
    const dir = path.join(tempDir, 'next-script');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'next dev' } }),
      'utf8',
    );

    const effective = resolveEffectiveGuide(
      { command: 'npm run dev' },
      { port: 4000, network: 'local' },
      { packageJsonDir: dir },
    );

    assert.equal(effective.stack, 'next');
    assert.equal(effective.command, 'npm run dev -- -p 4000');
    assert.equal(effective.command.includes('--port'), false);
  });

  test('resolveEffectiveGuide skips CLI port flags when package.json is missing', async () => {
    const dir = path.join(tempDir, 'missing-package-json');
    await fs.mkdir(dir, { recursive: true });

    const effective = resolveEffectiveGuide(
      { command: 'npm run dev' },
      { port: 4000, network: 'lan' },
      { packageJsonDir: dir },
    );

    assert.equal(effective.stack, 'unknown');
    assert.equal(effective.command, 'npm run dev');

    const env = buildDevServerSpawnEnv(effective.port, effective.network);
    assert.equal(env.PORT, '4000');
    assert.equal(env.VITE_PORT, '4000');
    assert.equal(env.HOST, '0.0.0.0');
  });
});
