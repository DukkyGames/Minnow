import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { appendChatTranscriptNode, QUEUED_TRANSCRIPT_ID } = await import(
  '../../src/ui/chat-mount.ts'
);

describe('appendChatTranscriptNode', () => {
  test('inserts live rows before the queued cluster so follow-ups stay at the tail', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const mount = document.createElement('div');
    mount.id = 'chatArea';
    document.body.appendChild(mount);

    const queued = document.createElement('div');
    queued.id = QUEUED_TRANSCRIPT_ID;
    mount.appendChild(queued);

    const live = document.createElement('div');
    live.className = 'msg assistant';
    appendChatTranscriptNode(live, mount);

    assert.equal(mount.firstElementChild, live);
    assert.equal(live.nextElementSibling, queued);
  });

  test('appends normally when nothing is queued', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const mount = document.createElement('div');
    const node = document.createElement('div');
    appendChatTranscriptNode(node, mount);
    assert.equal(mount.firstElementChild, node);
  });
});
