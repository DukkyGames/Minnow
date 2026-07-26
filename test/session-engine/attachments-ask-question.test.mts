/**
 * Engine multimodal attachments + ask_question pause/resume seam (MIN-354 residual).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { buildHistoryUserContent } from '../../src/attachments/api-content.ts';
import type { Attachment } from '../../src/attachments/types.ts';
import {
  cancelParkedAskQuestion,
  hasParkedAskQuestion,
  parkAskQuestion,
  resetAskQuestionBridgeForTests,
  resolveParkedAskQuestion,
} from '../../src/session-engine/ask-question-bridge.ts';
import {
  buildEngineApiMessages,
  buildEngineHistoryUserContent,
  normalizeSendAttachments,
} from '../../src/session-engine/build-api-messages.ts';
import type { Chat } from '../../src/types.ts';

afterEach(() => {
  resetAskQuestionBridgeForTests();
});

describe('normalizeSendAttachments', () => {
  it('keeps serializable attachment shapes and drops errors', () => {
    const raw = [
      {
        id: 'a1',
        name: 'shot.png',
        kind: 'image',
        mimeType: 'image/png',
        size: 12,
        dataUrl: 'data:image/png;base64,aaa',
      },
      { id: 'bad', name: 'x', kind: 'error', mimeType: '', size: 0, error: 'fail' },
      { name: 'no-kind' },
      null,
    ];
    const normalized = normalizeSendAttachments(raw);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0]?.kind, 'image');
  });
});

describe('buildEngineHistoryUserContent', () => {
  it('matches loop history format for image + text attachments', () => {
    const attachments: Attachment[] = [
      {
        id: 'i1',
        name: 'photo.png',
        kind: 'image',
        mimeType: 'image/png',
        size: 10,
        dataUrl: 'data:image/png;base64,abc',
      },
      {
        id: 't1',
        name: 'notes.txt',
        kind: 'text',
        mimeType: 'text/plain',
        size: 4,
        text: 'hello',
      },
    ];
    const fromEngine = buildEngineHistoryUserContent('describe', attachments);
    const fromShared = buildHistoryUserContent('describe', attachments);
    assert.equal(fromEngine, fromShared);
    assert.match(fromEngine, /\[image: photo\.png\]/);
    assert.match(fromEngine, /<file name="notes\.txt">/);
  });
});

describe('buildEngineApiMessages multimodal', () => {
  it('leaves non-VLM history string content unchanged when attachments present', () => {
    const history = buildHistoryUserContent('look', [
      {
        id: 'i1',
        name: 'a.png',
        kind: 'image',
        mimeType: 'image/png',
        size: 1,
        dataUrl: 'data:image/png;base64,xx',
      },
    ]);
    const chat = {
      id: 'c1',
      name: 't',
      workspacePath: '',
      modelId: 'plain-llm',
      history: [{ role: 'user', content: history }],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
    } as Chat;
    const messages = buildEngineApiMessages(chat, 'sys', {
      turnAttachments: [
        {
          id: 'i1',
          name: 'a.png',
          kind: 'image',
          mimeType: 'image/png',
          size: 1,
          dataUrl: 'data:image/png;base64,xx',
        },
      ],
      modelId: 'plain-llm',
      pendingUserText: 'look',
    });
    const user = messages.find((m) => m.role === 'user');
    assert.equal(typeof user?.content, 'string');
    assert.match(String(user?.content), /\[image: a\.png\]/);
  });

  it('rebuilds VLM image_url parts for vision model ids', () => {
    const history = buildHistoryUserContent('look', [
      {
        id: 'i1',
        name: 'a.png',
        kind: 'image',
        mimeType: 'image/png',
        size: 1,
        dataUrl: 'data:image/png;base64,xx',
      },
    ]);
    const chat = {
      id: 'c1',
      name: 't',
      workspacePath: '',
      modelId: 'llava-vision-test',
      history: [{ role: 'user', content: history }],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
    } as Chat;
    const messages = buildEngineApiMessages(chat, 'sys', {
      turnAttachments: [
        {
          id: 'i1',
          name: 'a.png',
          kind: 'image',
          mimeType: 'image/png',
          size: 1,
          dataUrl: 'data:image/png;base64,xx',
        },
      ],
      // Catalog-less fallback uses id regex (vlm|vision|llava|…).
      modelId: 'llava-vision-test',
      pendingUserText: 'look',
    });
    const user = messages.find((m) => m.role === 'user');
    assert.ok(Array.isArray(user?.content));
    const parts = user?.content as Array<{ type: string; image_url?: { url: string } }>;
    assert.ok(parts.some((p) => p.type === 'image_url' && p.image_url?.url === 'data:image/png;base64,xx'));
    assert.ok(parts.some((p) => p.type === 'text'));
  });
});

describe('ask_question bridge park/resume', () => {
  it('resolves parked question via answer result', async () => {
    const parked = parkAskQuestion('chat-a', 'tc-1', {
      questions: [
        {
          id: 'q1',
          prompt: 'Pick one',
          options: [
            { id: 'o1', label: 'A' },
            { id: 'o2', label: 'B' },
          ],
        },
      ],
    });
    assert.equal(hasParkedAskQuestion('chat-a'), true);
    const ok = resolveParkedAskQuestion(
      'chat-a',
      {
        status: 'answered',
        answers: [{ questionId: 'q1', selectedIds: ['o1'], otherText: null }],
      },
      'tc-1',
    );
    assert.equal(ok, true);
    const content = await parked;
    assert.match(content, /"status":"answered"/);
    assert.equal(hasParkedAskQuestion('chat-a'), false);
  });

  it('rejects mismatched toolCallId and cancels on stop', async () => {
    const parked = parkAskQuestion('chat-b', 'tc-9', {
      questions: [
        {
          id: 'q1',
          prompt: 'Pick one',
          options: [
            { id: 'o1', label: 'A' },
            { id: 'o2', label: 'B' },
          ],
        },
      ],
    });
    assert.equal(
      resolveParkedAskQuestion('chat-b', { status: 'cancelled', answers: [] }, 'wrong'),
      false,
    );
    assert.equal(cancelParkedAskQuestion('chat-b'), true);
    const content = await parked;
    assert.match(content, /"status":"cancelled"/);
  });
});
