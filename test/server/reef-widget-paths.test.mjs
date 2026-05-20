/**
 * Reef widget template path resolution (install dir vs workspace).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  getBuiltinReefWidgetsDir,
  tryResolveReefWidgetReadPath,
  tryResolveReefWidgetsFindRoot,
} from '../../server/reef/widget-paths.js';
import { getAppRoot } from '../../server/workspace/root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

describe('reef widget-paths', () => {
  test('getBuiltinReefWidgetsDir points at src/chat/reef/widgets', () => {
    const dir = getBuiltinReefWidgetsDir();
    assert.equal(dir, path.join(getAppRoot(), 'src', 'chat', 'reef', 'widgets'));
    assert.ok(fs.existsSync(path.join(dir, 'calculator.md')));
    assert.ok(fs.existsSync(path.join(dir, 'calculator-with-chart.md')));
  });

  test('@minnow/reef/widgets/calculator-with-chart.md resolves', () => {
    const resolved = tryResolveReefWidgetReadPath('@minnow/reef/widgets/calculator-with-chart.md');
    assert.ok(resolved);
    assert.ok(resolved.endsWith('calculator-with-chart.md'));
    assert.ok(fs.existsSync(resolved));
  });

  test('@minnow/reef/widgets/calculator.md resolves to install template', () => {
    const resolved = tryResolveReefWidgetReadPath('@minnow/reef/widgets/calculator.md');
    assert.ok(resolved);
    assert.ok(resolved.endsWith('calculator.md'));
    assert.ok(fs.existsSync(resolved));
  });

  test('src/chat/reef/widgets/*.md search redirects off workspace', () => {
    const root = tryResolveReefWidgetsFindRoot('src/chat/reef/widgets/*.md', '.');
    assert.ok(root);
    assert.ok(root.includes('reef'));
    assert.ok(fs.existsSync(root));
  });

  test('legacy repo-relative path still resolves', () => {
    const resolved = tryResolveReefWidgetReadPath('src/chat/reef/widgets/tabs.md');
    assert.ok(resolved);
    assert.ok(fs.existsSync(resolved));
  });
});
