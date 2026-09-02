/**
 * Heuristic detection for announce-then-stop assistant prose.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { looksLikeIntentToAct } from '../../src/tools/intent-to-act-detect.ts';

const GET9_LINE =
  'The user wants the **status-bar Tray only**. Let me set up my task list and inspect the existing icon asset and available image tooling before building.';

describe('looksLikeIntentToAct', () => {
  test('detects the GET-9 announce-then-stop line', () => {
    assert.equal(looksLikeIntentToAct(GET9_LINE), true);
  });

  test('detects Let me look at the renderer as the last sentence', () => {
    const text = `Here is the layout of the Code shell.

The tray lives in the status bar.

Let me look at the renderer and the existing icon asset.`;
    assert.equal(looksLikeIntentToAct(text), true);
  });

  test('ignores Let me know if you need anything', () => {
    assert.equal(looksLikeIntentToAct('Let me know if you need anything.'), false);
  });

  test('ignores I will wait for the user', () => {
    assert.equal(looksLikeIntentToAct("I'll wait for your answer."), false);
  });

  test('ignores a task-complete closer', () => {
    assert.equal(
      looksLikeIntentToAct('Task complete. The status-bar tray is wired.'),
      false,
    );
  });

  test('ignores a long answer whose last line offers tests', () => {
    const text = `The tray icon is a 22px template image.

I wired the click handler and hid the extra menu items.

Let me know if you want tests.`;
    assert.equal(looksLikeIntentToAct(text), false);
  });

  test('ignores a plain Done closer', () => {
    assert.equal(looksLikeIntentToAct('Done.'), false);
  });

  test('ignores a mid-reply Let me look when the last sentence is a summary', () => {
    const text = `Let me look at the renderer.

The icon is a template PNG in public/icons. That is the asset to reuse.`;
    assert.equal(looksLikeIntentToAct(text), false);
  });
});
