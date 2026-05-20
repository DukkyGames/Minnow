/**
 * Chat modeId shape and persistence defaults.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ensureChatShape } from '../../src/state/sessions.ts';

describe('chat modeId persistence', () => {
  test('ensureChatShape defaults modeId to build', () => {
    const chat = ensureChatShape({});
    assert.equal(chat.modeId, 'build');
  });

  test('round-trip preserves reef widget LLM overrides', () => {
    const raw = {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Reef',
      modelId: 'm1',
      modeId: 'reef',
      reefWidgetProviderId: 'prov-reef',
      reefWidgetModelId: 'model-reef',
      history: [],
      updatedAt: 1710000000000,
    };
    const chat = ensureChatShape(raw);
    assert.equal(chat.reefWidgetProviderId, 'prov-reef');
    assert.equal(chat.reefWidgetModelId, 'model-reef');
    const parsed = ensureChatShape(JSON.parse(JSON.stringify(chat)));
    assert.equal(parsed.reefWidgetModelId, 'model-reef');
  });

  test('round-trip preserves orchestrate', () => {
    const raw = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Test',
      modelId: 'm1',
      modeId: 'orchestrate',
      history: [],
      updatedAt: 1710000000000,
    };
    const chat = ensureChatShape(raw);
    assert.equal(chat.modeId, 'orchestrate');
    const json = JSON.stringify(chat);
    const parsed = ensureChatShape(JSON.parse(json));
    assert.equal(parsed.modeId, 'orchestrate');
  });

  test('round-trip preserves orchestratePlanPath when valid', () => {
    const raw = {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Orch',
      modelId: 'm1',
      modeId: 'orchestrate',
      orchestratePlanPath: 'documentation/plans/feature-31-ask-question-cards.md',
      history: [],
      updatedAt: 1710000000000,
    };
    const chat = ensureChatShape(raw);
    assert.equal(
      chat.orchestratePlanPath,
      'documentation/plans/feature-31-ask-question-cards.md',
    );
    const parsed = ensureChatShape(JSON.parse(JSON.stringify(chat)));
    assert.equal(
      parsed.orchestratePlanPath,
      'documentation/plans/feature-31-ask-question-cards.md',
    );
  });

  test('drops invalid orchestratePlanPath', () => {
    const raw = {
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Bad',
      modelId: 'm1',
      modeId: 'orchestrate',
      orchestratePlanPath: 'documentation/plans/references/mode-sources.md',
      history: [],
      updatedAt: 1710000000000,
    };
    const chat = ensureChatShape(raw);
    assert.equal(chat.orchestratePlanPath, undefined);
  });
});
