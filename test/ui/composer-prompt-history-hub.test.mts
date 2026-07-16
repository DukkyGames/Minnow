/**
 * Vibe hub composer ArrowUp recall uses workspace-wide user prompts (MIN-459).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Window } from 'happy-dom';

const {
  __resetComposerPromptHistoryForTests,
  collectWorkspaceUserPrompts,
  handleComposerPromptHistoryKeydown,
} = await import('../../src/ui/composer-prompt-history.ts');
const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { setWorkspaceFromServer, resetWorkspaceStateForTests } = await import(
  '../../src/state/workspace.ts'
);

const HUB_ROOT_ID = 'vibeHub';
const TEST_WS = '/ws';

function setupHappyDom(): void {
  const window = new Window();
  const g = globalThis as typeof globalThis & {
    window: Window;
    document: Document;
    HTMLElement: typeof HTMLElement;
    HTMLTextAreaElement: typeof HTMLTextAreaElement;
    KeyboardEvent: typeof KeyboardEvent;
    Event: typeof Event;
  };
  g.window = window as unknown as Window & typeof globalThis.window;
  g.document = window.document;
  g.HTMLElement = window.HTMLElement;
  g.HTMLTextAreaElement = window.HTMLTextAreaElement;
  g.KeyboardEvent = window.KeyboardEvent;
  g.Event = window.Event;
}

function mountHubComposer(): HTMLTextAreaElement {
  const hub = document.createElement('div');
  hub.id = HUB_ROOT_ID;
  document.body.appendChild(hub);

  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);
  return input;
}

function keydown(input: HTMLTextAreaElement, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return handleComposerPromptHistoryKeydown(event, input);
}

describe('composer-prompt-history on Vibe hub', () => {
  it('collectWorkspaceUserPrompts orders chats by last activity', () => {
    const older = createEmptyChatObject('model-a', TEST_WS);
    older.lastMessageAt = 100;
    older.history = [{ role: 'user', content: 'older chat' }];

    const newer = createEmptyChatObject('model-b', TEST_WS);
    newer.lastMessageAt = 200;
    newer.history = [{ role: 'user', content: 'newer chat' }];

    setSessionStateForTests({
      activeId: older.id,
      chats: [newer, older],
      lastActiveChatIdByWorkspace: {},
    });

    const prompts = collectWorkspaceUserPrompts(
      { activeId: older.id, chats: [newer, older], lastActiveChatIdByWorkspace: {} },
      TEST_WS,
    );
    assert.deepEqual(prompts, ['older chat', 'newer chat']);
  });

  it('ArrowUp on hub recalls newest workspace prompt when active chat is empty', () => {
    setupHappyDom();
    __resetComposerPromptHistoryForTests();
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({ path: TEST_WS, label: 'ws', isDefault: false });

    const prior = createEmptyChatObject('model-a', TEST_WS);
    prior.lastMessageAt = 100;
    prior.history = [
      { role: 'user', content: 'first prompt' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'latest prompt' },
    ];

    const empty = createEmptyChatObject('model-b', TEST_WS);
    empty.history = [];

    setSessionStateForTests({
      activeId: empty.id,
      chats: [prior, empty],
      lastActiveChatIdByWorkspace: {},
    });

    const input = mountHubComposer();
    input.value = '';
    input.setSelectionRange(0, 0);

    assert.equal(keydown(input, 'ArrowUp'), true);
    assert.equal(input.value, 'latest prompt');

    input.setSelectionRange(0, 0);
    assert.equal(keydown(input, 'ArrowUp'), true);
    assert.equal(input.value, 'first prompt');
  });
});
