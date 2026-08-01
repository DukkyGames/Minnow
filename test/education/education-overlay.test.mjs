/**
 * Education Mode exposure layer — denied set, filter behaviour, MCP mitigation.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EDUCATION_DENIED_TOOL_IDS,
  applyEducationCatalogFilter,
  applyEducationToolFilter,
  isExternalWriteToolName,
  isToolBlockedByEducationMode,
} from '../../src/chat/modes/education-overlay.ts';
import { TOOL_GROUP_IDS } from '../../src/chat/modes/tool-groups.ts';

const def = (name) => ({ type: 'function', function: { name, description: '', parameters: {} } });

describe('education tool overlay', () => {
  test('denied set covers the whole files-write group', () => {
    for (const id of TOOL_GROUP_IDS['files-write']) {
      assert.ok(
        EDUCATION_DENIED_TOOL_IDS.has(id),
        `files-write tool "${id}" is not denied by Education Mode`,
      );
    }
  });

  test('denies update_settings and the inline interpreters', () => {
    for (const id of ['update_settings', 'run_javascript', 'run_python']) {
      assert.ok(EDUCATION_DENIED_TOOL_IDS.has(id), `${id} should be denied`);
    }
  });

  test('keeps the tools the tutor teaches with', () => {
    const kept = [
      'execute_command',
      'start_background_command',
      'manage_dev_servers',
      'read_command_log',
      'stop_command',
      'git_add',
      'git_commit',
      'git_checkout',
      'git_diff',
      'read_file',
      'grep',
      // Pointing at code is the tutor's replacement for pasting it.
      'open_in_editor',
      'repo_map',
      'find_symbol',
      'get_lsp_diagnostics',
      'todo_write',
      'ask_question',
    ];
    for (const id of kept) {
      assert.equal(
        isToolBlockedByEducationMode(true, id),
        false,
        `${id} must stay available to the tutor`,
      );
    }
  });

  test('filter is a no-op when disabled', () => {
    const defs = [def('save_file'), def('read_file'), def('run_python')];
    assert.deepEqual(applyEducationToolFilter(false, defs), defs);
    assert.equal(isToolBlockedByEducationMode(false, 'save_file'), false);
  });

  test('filter strips write tools when enabled', () => {
    const defs = [def('save_file'), def('read_file'), def('execute_command'), def('delete_path')];
    const out = applyEducationToolFilter(true, defs).map((d) => d.function.name);
    assert.deepEqual(out, ['read_file', 'execute_command']);
  });

  test('filter is idempotent (applied in several paths by design)', () => {
    const defs = [def('save_file'), def('read_file')];
    const once = applyEducationToolFilter(true, defs);
    assert.deepEqual(applyEducationToolFilter(true, once), once);
  });

  test('catalog filter matches the definition filter', () => {
    const catalog = [
      { id: 'save_file', definition: def('save_file') },
      { id: 'read_file', definition: def('read_file') },
    ];
    const out = applyEducationCatalogFilter(true, catalog).map((t) => t.id);
    assert.deepEqual(out, ['read_file']);
  });

  test('MCP and plugin tools that read like mutations are stripped', () => {
    assert.ok(isExternalWriteToolName('mcp__filesystem__write_file'));
    assert.ok(isExternalWriteToolName('mcp__fs__create_directory'));
    assert.ok(isExternalWriteToolName('plugin__notes__save_page'));
    assert.ok(isExternalWriteToolName('mcp__github__delete_branch'));
  });

  test('MCP read tools and same-named built-ins are untouched', () => {
    assert.equal(isExternalWriteToolName('mcp__filesystem__read_file'), false);
    assert.equal(isExternalWriteToolName('mcp__context7__get_library_docs'), false);
    // The regex must only apply to external tools, never to the built-in catalog.
    assert.equal(isExternalWriteToolName('read_file'), false);
    assert.equal(isToolBlockedByEducationMode(true, 'recall_chat_context'), false);
    assert.equal(isToolBlockedByEducationMode(true, 'create_chat_with_mode'), false);
  });
});
