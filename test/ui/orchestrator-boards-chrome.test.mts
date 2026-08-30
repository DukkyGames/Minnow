/**
 * V2 Boards hides Code chat chrome (session list + composer).
 * CSS-only so this file does not import the boards-view module graph.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('V2 Boards chrome', () => {
  test('hides the Code session list while the Boards surface is mounted', () => {
    const css = readFileSync(new URL('../../src/styles/code-chrome.css', import.meta.url), 'utf8');
    assert.ok(
      css.includes('html:has(#orchestratorBoardsRoot) #chatSidebar'),
      'V2 Boards must hide #chatSidebar the same way V1 Orchestrate does',
    );
    assert.ok(
      !css.includes('html:has(#orchestratorBoardsRoot) #btnCodeViewsChats'),
      'Chats toggle should stay visible',
    );
  });

  test('hides the Code composer while the Boards surface is mounted', () => {
    const css = readFileSync(
      new URL('../../src/styles/orchestrator-boards.css', import.meta.url),
      'utf8',
    );
    const marker = '.main-column.main-column--orchestrator-boards .input-bar';
    const start = css.indexOf(marker);
    assert.ok(start >= 0, 'composer hide selector must exist');
    const rule = css.slice(start, css.indexOf('}', start));
    assert.ok(rule.includes('display: none'), 'composer hide must be display:none');
  });
});
