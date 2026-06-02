import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  augmentDevServerCommand,
  buildDevServerSpawnEnv,
  resolveEffectiveGuide,
  rewriteHealthUrlForProbe,
} from '../../server/dev-server/effective-guide.js';

describe('effective dev-server guide', () => {
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
});
