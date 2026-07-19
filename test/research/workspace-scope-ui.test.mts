/**
 * Deep Research workspace scope UI helpers.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  ensureResearchWorkspaceOption,
  populateResearchWorkspaceSelect,
  readResearchWorkspaceRoot,
  researchWorkspaceBasename,
  scopeIncludesCodebase,
  syncResearchWorkspaceFieldVisibility,
} from '../../src/research/workspace-scope-ui.ts';

describe('research workspace-scope-ui', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis.window;
    globalThis.document = win.document;
    globalThis.HTMLElement = win.HTMLElement;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('scopeIncludesCodebase is true for codebase and both', () => {
    assert.equal(scopeIncludesCodebase('codebase'), true);
    assert.equal(scopeIncludesCodebase('both'), true);
    assert.equal(scopeIncludesCodebase('web'), false);
  });

  test('populateResearchWorkspaceSelect prefers recent workspaces', () => {
    const select = document.createElement('select');
    populateResearchWorkspaceSelect(select, {
      path: '/current',
      label: 'Current',
      isDefault: false,
      recent: [
        {
          path: '/projects/a',
          label: 'Project A',
          exists: true,
          isCurrent: false,
        },
        {
          path: '/projects/b',
          label: 'Project B',
          exists: true,
          isCurrent: true,
        },
      ],
    });

    assert.equal(select.options.length, 2);
    assert.equal(select.value, '/projects/b');
    assert.equal(select.options[1]?.textContent, 'Project B');
  });

  test('syncResearchWorkspaceFieldVisibility toggles hidden', () => {
    const field = document.createElement('label');
    syncResearchWorkspaceFieldVisibility('web', field);
    assert.equal(field.hidden, true);
    assert.equal(field.classList.contains('hidden'), true);
    assert.equal(field.getAttribute('aria-hidden'), 'true');
    syncResearchWorkspaceFieldVisibility('codebase', field);
    assert.equal(field.hidden, false);
    assert.equal(field.classList.contains('hidden'), false);
    assert.equal(field.getAttribute('aria-hidden'), 'false');
    syncResearchWorkspaceFieldVisibility('both', field);
    assert.equal(field.hidden, false);
  });

  test('readResearchWorkspaceRoot returns undefined for web scope', () => {
    const select = document.createElement('select');
    const opt = document.createElement('option');
    opt.value = '/projects/a';
    opt.selected = true;
    select.appendChild(opt);
    assert.equal(readResearchWorkspaceRoot(select, 'web'), undefined);
    assert.equal(readResearchWorkspaceRoot(select, 'codebase'), '/projects/a');
  });

  test('ensureResearchWorkspaceOption adds custom browse paths', () => {
    const select = document.createElement('select');
    ensureResearchWorkspaceOption(select, '/custom/project');
    assert.equal(select.value, '/custom/project');
    assert.equal(select.options[0]?.textContent, 'project');
    ensureResearchWorkspaceOption(select, '/other/folder', 'Other Folder');
    assert.equal(select.options.length, 2);
    assert.equal(select.value, '/other/folder');
    ensureResearchWorkspaceOption(select, '/custom/project');
    assert.equal(select.value, '/custom/project');
  });

  test('researchWorkspaceBasename handles drive roots', () => {
    assert.equal(researchWorkspaceBasename('C:\\Users\\dev\\Minnow'), 'Minnow');
    assert.equal(researchWorkspaceBasename('C:'), 'C:\\');
  });
});
