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
  getHomeReefModulesDir,
  isReefWidgetPathAlias,
  tryResolveReefModulePath,
  tryResolveReefModulesFindRoot,
  tryResolveReefWidgetReadPath,
  tryResolveReefWidgetsFindRoot,
} from '../../server/reef/widget-paths.js';
import { ensureMinnowLayout, resetMinnowHomeCache } from '../../server/config/home.js';
import { getAppRoot } from '../../server/workspace/root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

/** Phase 1 Reef Widget Library — install-dir templates. */
const PHASE1_REEF_WIDGETS = [
  'checklist.md',
  'stats-dashboard.md',
  'pie-chart.md',
  'heatmap.md',
  'quiz.md',
  'qa-callllm.md',
  'timeline.md',
  'unit-converter.md',
];

/** Phase 2 Reef Widget Library — reusable snippet templates. */
const PHASE2_SNIPPETS = [
  'snippet-chart-line.md',
  'snippet-chart-bar.md',
  'snippet-table.md',
  'snippet-stat-card.md',
  'snippet-input-row.md',
  'snippet-sparkline.md',
];

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

  for (const name of PHASE1_REEF_WIDGETS) {
    test(`@minnow/reef/widgets/${name} resolves`, () => {
      const resolved = tryResolveReefWidgetReadPath(`@minnow/reef/widgets/${name}`);
      assert.ok(resolved, `expected path for ${name}`);
      assert.ok(resolved.endsWith(name));
      assert.ok(fs.existsSync(resolved), `missing file on disk: ${resolved}`);
    });
  }

  for (const name of PHASE2_SNIPPETS) {
    test(`@minnow/reef/widgets/${name} resolves (Phase 2 snippet)`, () => {
      const resolved = tryResolveReefWidgetReadPath(`@minnow/reef/widgets/${name}`);
      assert.ok(resolved, `expected path for ${name}`);
      assert.ok(resolved.endsWith(name));
      assert.ok(fs.existsSync(resolved), `missing file on disk: ${resolved}`);
    });
  }

  test('find_files: @minnow/reef/widgets/snippet-*.md redirects off workspace', () => {
    const root = tryResolveReefWidgetsFindRoot(
      '@minnow/reef/widgets/snippet-*.md',
      '@minnow/reef/widgets',
    );
    assert.ok(root);
    assert.ok(root.includes('reef'));
    assert.ok(fs.existsSync(root));
    const builtin = getBuiltinReefWidgetsDir();
    assert.equal(root, builtin);
  });

  test('find_files: src/chat/reef/widgets/snippet-*.md pattern redirects', () => {
    const root = tryResolveReefWidgetsFindRoot('src/chat/reef/widgets/snippet-*.md', '.');
    assert.ok(root);
    assert.ok(fs.existsSync(root));
  });
});

describe('reef module-paths', () => {
  /** @type {string} */
  let tempHome;

  test('setup temp MINNOW_HOME with reef/modules scaffold', async () => {
    tempHome = path.join(REPO_ROOT, 'test', 'tmp', 'reef-modules-home');
    await fs.promises.rm(tempHome, { recursive: true, force: true });
    process.env.MINNOW_HOME = tempHome;
    resetMinnowHomeCache();
    await ensureMinnowLayout();
    const modulesDir = getHomeReefModulesDir();
    assert.ok(fs.existsSync(modulesDir));
    assert.ok(fs.existsSync(path.join(modulesDir, '.gitkeep')));
  });

  test('@minnow/reef/modules/my-widget.md resolves under home', () => {
    const resolved = tryResolveReefModulePath('@minnow/reef/modules/my-widget.md');
    assert.ok(resolved);
    assert.equal(resolved, path.join(getHomeReefModulesDir(), 'my-widget.md'));
  });

  test('reef/modules/*.md resolves under home', () => {
    const resolved = tryResolveReefModulePath('reef/modules/saved.md');
    assert.ok(resolved);
    assert.equal(resolved, path.join(getHomeReefModulesDir(), 'saved.md'));
  });

  test('path traversal outside modules dir is rejected', () => {
    const resolved = tryResolveReefModulePath('@minnow/reef/modules/../../../outside.md');
    assert.equal(resolved, null);
  });

  test('find_files: @minnow/reef/modules redirects to home modules dir', () => {
    const root = tryResolveReefModulesFindRoot('*.md', '@minnow/reef/modules');
    assert.ok(root);
    assert.equal(root, getHomeReefModulesDir());
  });

  test('isReefWidgetPathAlias detects template paths', () => {
    assert.equal(isReefWidgetPathAlias('@minnow/reef/widgets/calculator.md'), true);
    assert.equal(isReefWidgetPathAlias('src/chat/reef/widgets/tabs.md'), true);
    assert.equal(isReefWidgetPathAlias('@minnow/reef/modules/foo.md'), false);
  });

  test('teardown temp MINNOW_HOME', async () => {
    await fs.promises.rm(tempHome, { recursive: true, force: true });
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
  });
});
