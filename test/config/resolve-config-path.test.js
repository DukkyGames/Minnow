import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { resolveConfigPath } from '../../server/config/paths.js';
import { setTestHome, rmTestHome } from './test-helpers.js';

describe('resolveConfigPath', () => {
  let homeDir;

  before(() => {
    homeDir = setTestHome(process.env);
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  test('rejects sessions/state.json (SQLite bypasses allowlist)', () => {
    // A.2: sessions live in sessions.db via sessions-paths.js, not ALLOWED_CONFIG_FILES.
    assert.throws(() => resolveConfigPath('sessions/state.json'), /Invalid config path/);
  });

  test('rejects parent traversal', () => {
    assert.throws(() => resolveConfigPath('../outside.json'), /Invalid config path/);
  });

  test('rejects windows-style traversal', () => {
    assert.throws(() => resolveConfigPath('..\\windows\\escape'), /Invalid config path/);
  });

  test('rejects absolute paths', () => {
    assert.throws(() => resolveConfigPath('/etc/passwd'), /Invalid config path/);
  });

  test('rejects unknown keys', () => {
    assert.throws(() => resolveConfigPath('providers/foo.json'), /Invalid config path/);
  });

  test('allows appearance.json', () => {
    assert.ok(resolveConfigPath('appearance.json'));
  });
});
