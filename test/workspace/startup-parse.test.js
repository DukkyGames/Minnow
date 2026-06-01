import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  coerceStartupGuide,
  parseStartupMarkdown,
  startupFilePath,
} from '../../server/dev-server/parse-startup.js';
import { resolveSafePath } from '../../server/runtime/path-access.js';
import { getWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';
import { ensureMinnowLayout } from '../../server/config/home.js';

const SAMPLE = `---
command: npm run dev
cwd: apps/web
healthUrl: http://localhost:5173/
port: 5173
stop:
  command: npx kill-port 5173
---
Notes for humans.
`;

describe('startup.md parse', () => {
  test('parses frontmatter and body', () => {
    const { guide, body, error } = parseStartupMarkdown(SAMPLE);
    assert.equal(error, undefined);
    assert.ok(guide);
    assert.equal(guide.command, 'npm run dev');
    assert.equal(guide.cwd, 'apps/web');
    assert.equal(guide.healthUrl, 'http://localhost:5173/');
    assert.equal(guide.port, 5173);
    assert.equal(guide.stop?.command, 'npx kill-port 5173');
    assert.match(body, /Notes for humans/);
  });

  test('requires command in frontmatter', () => {
    const { guide, error } = parseStartupMarkdown('---\nport: 3000\n---\n');
    assert.equal(guide, null);
    assert.ok(error);
  });

  test('coerceStartupGuide rejects empty command', () => {
    assert.equal(coerceStartupGuide({ cwd: '.' }), null);
  });
});

describe('startup cwd resolution', () => {
  test('resolveSafePath keeps cwd under workspace', async () => {
    const homeDir = setTestHome(process.env, 'minnow-test-startup-cwd');
    await ensureMinnowLayout();
    const ws = path.join(homeDir, 'ws');
    await import('node:fs/promises').then((fs) => fs.mkdir(ws, { recursive: true }));
    await setWorkspaceRoot(ws);
    const resolved = resolveSafePath('subdir', { write: false });
    assert.equal(resolved, path.join(getWorkspaceRoot(), 'subdir'));
    await rmTestHome(homeDir);
  });

  test('startupFilePath is workspace root file', () => {
    const p = startupFilePath('/tmp/project');
    assert.equal(p, path.join('/tmp/project', 'startup.md'));
  });
});
