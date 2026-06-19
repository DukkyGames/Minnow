/**
 * Shell run kill UI: registry, runId parsing, tool-call Stop button.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  extractShellRunIdFromToolResult,
  isKillableShellTool,
  renderToolCall,
  setToolCallShellRun,
} from '../../src/ui/tool-messages.ts';
import {
  getShellRunIdForToolCall,
  listActiveShellRuns,
  registerShellRun,
  resetShellRunRegistryForTests,
  unregisterShellRun,
} from '../../src/ui/shell-run-registry.ts';

function setupDom(): Window {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = '<main id="chatArea"></main>';
  return window;
}

describe('shell run kill UI', () => {
  /** @type {import('happy-dom').Window | undefined} */
  let window: Window | undefined;

  afterEach(() => {
    resetShellRunRegistryForTests();
    window?.close();
    window = undefined;
  });

  test('isKillableShellTool matches execute_command and start_background_command', () => {
    assert.equal(isKillableShellTool('execute_command'), true);
    assert.equal(isKillableShellTool('start_background_command'), true);
    assert.equal(isKillableShellTool('read_file'), false);
  });

  test('extractShellRunIdFromToolResult parses background execute_command JSON', () => {
    const result = JSON.stringify({
      ok: true,
      background: true,
      runId: '11111111-1111-1111-1111-111111111111',
    });
    assert.equal(
      extractShellRunIdFromToolResult('execute_command', result),
      '11111111-1111-1111-1111-111111111111',
    );
  });

  test('extractShellRunIdFromToolResult parses start_background_command JSON', () => {
    const result = JSON.stringify({
      ok: true,
      runId: '22222222-2222-2222-2222-222222222222',
    });
    assert.equal(
      extractShellRunIdFromToolResult('start_background_command', result),
      '22222222-2222-2222-2222-222222222222',
    );
  });

  test('renderToolCall adds hidden Stop for execute_command', () => {
    window = setupDom();
    const wrap = renderToolCall('execute_command', { command: 'npm run dev' });
    const killBtn = wrap.querySelector('.tool-call-kill');
    assert.ok(killBtn);
    assert.ok(killBtn.classList.contains('hidden'));
  });

  test('setToolCallShellRun reveals Stop while run is active', () => {
    window = setupDom();
    const wrap = renderToolCall('execute_command', { command: 'sleep 60' });
    setToolCallShellRun(wrap, '33333333-3333-3333-3333-333333333333', true);
    const killBtn = wrap.querySelector<HTMLButtonElement>('.tool-call-kill');
    assert.ok(killBtn);
    assert.equal(killBtn.classList.contains('hidden'), false);
    assert.equal(killBtn.disabled, false);
    setToolCallShellRun(wrap, null, false);
    assert.ok(killBtn.classList.contains('hidden'));
  });

  test('registerShellRun maps toolCallId to runId', () => {
    registerShellRun({
      runId: '44444444-4444-4444-4444-444444444444',
      command: 'vite',
      toolCallId: 'call_abc',
    });
    assert.equal(
      getShellRunIdForToolCall('call_abc'),
      '44444444-4444-4444-4444-444444444444',
    );
    assert.equal(listActiveShellRuns().length, 1);
    unregisterShellRun('44444444-4444-4444-4444-444444444444');
    assert.equal(listActiveShellRuns().length, 0);
  });
});
