import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  clearDevHostState,
  readDevHostState,
  writeDevHostState,
} from '../../server/runtime/dev-host-state.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

describe('dev host state', () => {
  let homeDir;

  before(() => {
    homeDir = setTestHome(process.env);
    clearDevHostState();
  });

  after(async () => {
    clearDevHostState();
    await rmTestHome(homeDir);
    resetMinnowHomeCache();
  });

  test('writeDevHostState round-trips localUrl and port', () => {
    writeDevHostState({ localUrl: 'http://localhost:9474', port: 9474 });
    const state = readDevHostState();
    assert.ok(state);
    assert.equal(state.port, 9474);
    assert.equal(state.localUrl, 'http://localhost:9474');
    const file = path.join(homeDir, 'run', 'dev-host.json');
    assert.equal(fs.existsSync(file), true);
  });

  test('clearDevHostState removes the file', () => {
    writeDevHostState({ localUrl: 'http://localhost:9473', port: 9473 });
    clearDevHostState();
    assert.equal(readDevHostState(), null);
  });
});
