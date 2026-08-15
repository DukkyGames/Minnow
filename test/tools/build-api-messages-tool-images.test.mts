/**
 * Tool screenshot pixels must reach vision models as image_url follow-ups.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import { buildApiMessages } from '../../src/tools/loop.ts';
import {
  TOOL_IMAGE_FOLLOW_UP_TEXT,
  TOOL_IMAGE_NO_VISION_HINT,
} from '../../src/chat/tool-image-follow-up.ts';
import type { Chat } from '../../src/types.ts';

const PNG_DATA_URL = 'data:image/png;base64,aaa';

function chatWithScreenshot(): Chat {
  return {
    id: 'chat-shot-1',
    name: 'Screenshot',
    workspacePath: '/tmp/ws',
    modelId: 'test-model',
    modeId: 'build',
    history: [
      { role: 'user', content: 'Check the UI' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_shot',
            type: 'function',
            function: { name: 'browser_screenshot', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_shot',
        content: 'Screenshot saved: shot1.png\nURL: /api/browser/screenshot/shot1\n(2 KB)',
        attachments: [
          {
            type: 'image',
            url: '/api/browser/screenshot/shot1',
            mime: 'image/png',
            alt: 'Browser screenshot',
            dataUrl: PNG_DATA_URL,
          },
        ],
      },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
  };
}

describe('buildApiMessages tool screenshots', () => {
  let previousWindow: unknown;

  beforeEach(() => {
    previousWindow = globalThis.window;
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis.window;
    globalThis.document = win.document as unknown as Document;
  });

  afterEach(() => {
    globalThis.window = previousWindow as typeof globalThis.window;
  });

  test('vision models get an image_url follow-up after the tool result', () => {
    const messages = buildApiMessages(chatWithScreenshot(), 'sys', {
      composedSystemPrompt: 'sys',
      vision: true,
    });
    const tool = messages.find((m) => m.role === 'tool');
    assert.ok(tool);
    assert.equal(typeof tool.content, 'string');
    assert.match(String(tool.content), /shot1\.png/);
    assert.doesNotMatch(String(tool.content), /cannot view images/);

    const followUp = messages.find(
      (m) => m.role === 'user' && Array.isArray(m.content),
    );
    assert.ok(followUp);
    assert.equal(followUp.role, 'user');
    if (followUp.role !== 'user' || !Array.isArray(followUp.content)) {
      assert.fail('expected multimodal user follow-up');
    }
    assert.equal(followUp.toolImageFollowUp, true);
    const textPart = followUp.content.find((p) => p.type === 'text');
    const imagePart = followUp.content.find((p) => p.type === 'image_url');
    assert.equal(textPart && 'text' in textPart ? textPart.text : '', TOOL_IMAGE_FOLLOW_UP_TEXT);
    assert.equal(
      imagePart && 'image_url' in imagePart ? imagePart.image_url.url : '',
      PNG_DATA_URL,
    );
  });

  test('non-vision models get a hint and no image_url follow-up', () => {
    const messages = buildApiMessages(chatWithScreenshot(), 'sys', {
      composedSystemPrompt: 'sys',
      vision: false,
    });
    const tool = messages.find((m) => m.role === 'tool');
    assert.ok(tool);
    assert.match(String(tool.content), /cannot view images/);
    assert.ok(String(tool.content).includes(TOOL_IMAGE_NO_VISION_HINT.trim()));
    assert.equal(
      messages.some((m) => m.role === 'user' && Array.isArray(m.content)),
      false,
    );
  });
});
