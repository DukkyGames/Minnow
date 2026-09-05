import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildWindowClosePromptCopy,
  formatNativeWindowCloseDetail,
  parseWindowClosePromptIpc,
  parseWindowClosePromptReply,
} from '../../electron/window-close-prompt.ts';

describe('buildWindowClosePromptCopy', () => {
  test('includes the folder path and the background-vs-close explanation', () => {
    const copy = buildWindowClosePromptCopy(
      'C:\\Users\\dukky\\.minnow\\workspace',
      'workspace',
    );
    assert.equal(copy.title, 'Close workspace?');
    assert.equal(copy.heading, 'Close workspace?');
    assert.equal(copy.folder, 'C:\\Users\\dukky\\.minnow\\workspace');
    assert.equal(copy.checkboxLabel, 'Do this every time');
    assert.match(copy.detail, /background/);
    assert.match(copy.detail, /drops the folder/);
  });

  test('omits the path-specific sentence when the window is still at the gate', () => {
    const copy = buildWindowClosePromptCopy('', 'this window');
    assert.equal(copy.heading, 'Close this window?');
    assert.equal(copy.folder, '');
    assert.equal(
      copy.detail,
      'Keeping it in the background leaves it running and reachable from the tray.',
    );
  });
});

describe('formatNativeWindowCloseDetail', () => {
  test('puts the path above the explanation', () => {
    const copy = buildWindowClosePromptCopy('/repo/minnow', 'minnow');
    assert.equal(formatNativeWindowCloseDetail(copy), `${copy.folder}\n\n${copy.detail}`);
  });
});

describe('parseWindowClosePromptReply', () => {
  test('accepts close and background and ignores remember on cancel', () => {
    assert.deepEqual(parseWindowClosePromptReply({ action: 'close', remember: true }), {
      action: 'close',
      remember: true,
    });
    assert.deepEqual(parseWindowClosePromptReply({ action: 'background', remember: false }), {
      action: 'background',
      remember: false,
    });
    assert.deepEqual(parseWindowClosePromptReply({ action: 'cancel', remember: true }), {
      action: 'cancel',
      remember: false,
    });
  });

  test('treats junk as cancel', () => {
    assert.deepEqual(parseWindowClosePromptReply(null), { action: 'cancel', remember: false });
    assert.deepEqual(parseWindowClosePromptReply({ action: 'explode' }), {
      action: 'cancel',
      remember: false,
    });
  });
});

describe('parseWindowClosePromptIpc', () => {
  test('keeps the request id with the reply', () => {
    assert.deepEqual(
      parseWindowClosePromptIpc({
        requestId: 'wcp-3-1',
        action: 'background',
        remember: true,
      }),
      { requestId: 'wcp-3-1', action: 'background', remember: true },
    );
  });
});
