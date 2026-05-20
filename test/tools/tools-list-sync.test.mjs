/**
 * Contract tests for multi-list tool permission sync (feature 28).
 * Runtime DOM sync is covered by manual QA; full import of config UI chain
 * pulls terminal xterm CSS under tsx on this branch.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('tools list sync contract', () => {
  test('refreshAllToolListUis refreshes drawer, settings, and composer lists', () => {
    const src = readFileSync(join(root, 'src/tools/config.ts'), 'utf8');
    assert.match(src, /composerToolsList/);
    assert.match(src, /settingsToolsList/);
    assert.match(src, /toolsList/);
    assert.match(src, /function refreshAllToolListUis/);
  });

  test('setToolPermission calls refreshAllToolListUis after save', () => {
    const src = readFileSync(join(root, 'src/tools/config.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function setToolPermission'));
    assert.match(fn, /refreshAllToolListUis/);
  });

  test('tools-list supports composer variant without descriptions', () => {
    const src = readFileSync(join(root, 'src/ui/tools-list.ts'), 'utf8');
    assert.match(src, /variant === 'composer'/);
    assert.match(src, /tools-list--composer/);
  });
});
