import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MINNOW_DEFAULT_PORT } from '../../server/constants/minnow-port.js';
import { assessHostPortBindCommand } from '../../server/tools/host-port-bind-guard.js';

const port = String(MINNOW_DEFAULT_PORT);

describe('host port bind guard', () => {
  test('blocks explicit bind to the live Minnow port', () => {
    for (const cmd of [
      `PORT=${port} npm run dev`,
      `$env:PORT=${port}; npm run dev`,
      `set PORT=${port} && npm run dev`,
      `npx vite --port ${port}`,
      `npm run dev -- --port=${port}`,
      `next dev -p${port}`,
    ]) {
      const result = assessHostPortBindCommand(cmd);
      assert.ok(result, `expected block for: ${cmd}`);
      assert.match(result, /refusing to run/);
    }
  });

  test('allows Vite default and other ports', () => {
    for (const cmd of [
      'npm run dev',
      'npx vite --port 5173',
      'PORT=5173 npm run dev',
      `curl http://localhost:${port}/api/tools/ping`,
      'npm test',
    ]) {
      assert.equal(assessHostPortBindCommand(cmd), null, `expected allow for: ${cmd}`);
    }
  });
});
