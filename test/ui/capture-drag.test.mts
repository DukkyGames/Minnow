/**
 * Capture drag layer: active-drag descriptor during dragover.
 */

import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';

import { WORKSPACE_FILE_MIME } from '../../src/attachments/workspace-ref';
import { CHAT_DRAG_MIME } from '../../src/attachments/chat-drag';
import { ISSUE_DRAG_MIME, beginIssueDrag, resetIssueDragForTests } from '../../src/issues/issue-drag';
import {
  beginCaptureDrag,
  capturePayloadFromDataTransfer,
  dataTransferLooksCapturable,
  resetCaptureDragForTests,
} from '../../src/ui/capture-drag';

function fakeTransfer(types: string[] = []): DataTransfer {
  const store = new Map<string, string>();
  return {
    get types() {
      return [...store.keys(), ...types.filter((type) => !store.has(type))];
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'none',
  } as unknown as DataTransfer;
}

describe('dataTransferLooksCapturable', () => {
  afterEach(() => {
    resetCaptureDragForTests();
    resetIssueDragForTests();
  });

  test('returns true while a capture drag is active even without MIME types', () => {
    beginCaptureDrag(null, {
      items: [{ kind: 'file', label: 'foo.ts', codeRef: { path: 'src/foo.ts' } }],
    });
    assert.equal(dataTransferLooksCapturable(null), true);
  });

  test('returns true for workspace file MIME on the transfer', () => {
    const transfer = {
      types: [WORKSPACE_FILE_MIME],
    } as DataTransfer;
    assert.equal(dataTransferLooksCapturable(transfer), true);
  });

  test('returns true for sidebar chat drags', () => {
    const transfer = fakeTransfer([CHAT_DRAG_MIME, 'text/plain']);
    assert.equal(dataTransferLooksCapturable(transfer), true);
  });

  test('returns true for plain-text selection drags', () => {
    const transfer = fakeTransfer(['text/plain']);
    assert.equal(dataTransferLooksCapturable(transfer), true);
  });

  test('returns false for OS file drags that also carry text/plain', () => {
    const transfer = fakeTransfer(['Files', 'text/plain']);
    assert.equal(dataTransferLooksCapturable(transfer), false);
  });

  test('returns false for issue-row drags even when they also set text/plain', () => {
    const transfer = fakeTransfer([ISSUE_DRAG_MIME, 'text/plain']);
    transfer.setData(ISSUE_DRAG_MIME, 'MIN-1');
    transfer.setData('text/plain', 'MIN-1');
    assert.equal(dataTransferLooksCapturable(transfer), false);
  });

  test('returns false while an issue-row drag is in flight', () => {
    beginIssueDrag(['MIN-1']);
    assert.equal(dataTransferLooksCapturable(null), false);
  });
});

describe('capturePayloadFromDataTransfer', () => {
  afterEach(() => {
    resetCaptureDragForTests();
    resetIssueDragForTests();
  });

  test('builds a chat item from sidebar chat drags', () => {
    const transfer = fakeTransfer([CHAT_DRAG_MIME, 'text/plain']);
    transfer.setData(CHAT_DRAG_MIME, 'chat-abc');
    const payload = capturePayloadFromDataTransfer(transfer);
    assert.ok(payload);
    assert.equal(payload.sourceLabel, 'Chat');
    assert.equal(payload.items[0].kind, 'chat');
    assert.equal(payload.items[0].chatId, 'chat-abc');
  });

  test('builds a text item from a native selection drag', () => {
    const transfer = fakeTransfer(['text/plain']);
    transfer.setData('text/plain', 'Fix the sidebar drag\nSecond line');
    const payload = capturePayloadFromDataTransfer(transfer);
    assert.ok(payload);
    assert.equal(payload.sourceLabel, 'Selection');
    assert.equal(payload.title, 'Fix the sidebar drag');
    assert.equal(payload.items[0].kind, 'text');
    assert.equal(payload.items[0].text, 'Fix the sidebar drag\nSecond line');
  });

  test('ignores internal plain-text tab payloads', () => {
    const transfer = fakeTransfer(['text/plain']);
    transfer.setData('text/plain', 'file:src/foo.ts');
    assert.equal(capturePayloadFromDataTransfer(transfer), null);
  });

  test('ignores issue-row drags that also carry text/plain ids', () => {
    const transfer = fakeTransfer([ISSUE_DRAG_MIME, 'text/plain']);
    transfer.setData(ISSUE_DRAG_MIME, 'MIN-1,MIN-2');
    transfer.setData('text/plain', 'MIN-1,MIN-2');
    assert.equal(capturePayloadFromDataTransfer(transfer), null);
  });
});
