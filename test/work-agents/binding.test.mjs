import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveWorkAgentBinding } from '../../src/agents/resolve-work-agent-binding.ts';
import { WorkAgentConfigError } from '../../src/agents/work-agent-types.ts';

const MOCK_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    apiKind: 'openai-v1',
    enabled: true,
    connectionMode: 'proxy',
    hasApiKey: true,
    hasBearer: false,
  },
  {
    id: 'lm-studio-local',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234',
    apiKind: 'lm-studio-v0',
    enabled: true,
    connectionMode: 'direct',
    hasApiKey: false,
    hasBearer: false,
  },
];

const CHAT_BASE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Test',
  modelId: 'local-model',
  history: [],
  lastStats: null,
  modelInfo: {},
  updatedAt: 0,
};

describe('resolveWorkAgentBinding', () => {
  test('builder with explicit providerId and modelId', async () => {
    const agent = {
      id: 'builder',
      label: 'Builder',
      description: '',
      kind: 'work-agent',
      version: '1',
      providerId: 'openai',
      modelId: 'gpt-4o',
      allowedTools: null,
    };
    const binding = await resolveWorkAgentBinding(
      agent,
      CHAT_BASE,
      { providerId: 'lm-studio-local', modelId: 'ignored' },
      { providers: MOCK_PROVIDERS },
    );
    assert.deepEqual(binding, {
      agentId: 'builder',
      providerId: 'openai',
      modelId: 'gpt-4o',
      baseUrl: '',
      headers: {},
    });
  });

  test('null provider and model fall back to chat', async () => {
    const agent = {
      id: 'builder',
      label: 'Builder',
      description: '',
      kind: 'work-agent',
      version: '1',
      providerId: null,
      modelId: null,
      allowedTools: null,
    };
    const binding = await resolveWorkAgentBinding(
      agent,
      CHAT_BASE,
      { providerId: 'lm-studio-local', modelId: 'fallback-model' },
      { providers: MOCK_PROVIDERS },
    );
    assert.equal(binding.modelId, 'local-model');
    assert.equal(binding.providerId, 'lm-studio-local');
    assert.equal(binding.baseUrl, 'http://localhost:1234');
  });

  test('override sets model only', async () => {
    const agent = {
      id: 'builder',
      label: 'Builder',
      description: '',
      kind: 'work-agent',
      version: '1',
      providerId: 'openai',
      modelId: 'gpt-4o',
      allowedTools: null,
    };
    const binding = await resolveWorkAgentBinding(
      agent,
      CHAT_BASE,
      { providerId: 'lm-studio-local', modelId: 'x' },
      {
        providers: MOCK_PROVIDERS,
        userOverride: { modelId: 'override-model' },
      },
    );
    assert.equal(binding.providerId, 'openai');
    assert.equal(binding.modelId, 'override-model');
  });

  test('invalid provider id throws WorkAgentConfigError', async () => {
    const agent = {
      id: 'builder',
      label: 'Builder',
      description: '',
      kind: 'work-agent',
      version: '1',
      providerId: 'does-not-exist',
      modelId: 'gpt-4o',
      allowedTools: null,
    };
    await assert.rejects(
      () =>
        resolveWorkAgentBinding(agent, CHAT_BASE, {
          providerId: 'lm-studio-local',
          modelId: 'm',
        }, { providers: MOCK_PROVIDERS }),
      (err) => {
        assert.ok(err instanceof WorkAgentConfigError);
        assert.match(err.message, /does-not-exist/);
        return true;
      },
    );
  });

  test('default agent uses chat-only binding', async () => {
    const binding = await resolveWorkAgentBinding(
      null,
      CHAT_BASE,
      { providerId: 'lm-studio-local', modelId: 'fallback-model' },
      { providers: MOCK_PROVIDERS },
    );
    assert.equal(binding.agentId, 'default');
    assert.equal(binding.modelId, 'local-model');
    assert.equal(binding.providerId, 'lm-studio-local');
  });
});
