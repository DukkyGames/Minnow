/**
 * Sub-agent runner retries transient fetch errors on cloud providers (parity with main chat loop).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { defaultSubAgentRunner } from '../../src/agents/sub-agent-runner.ts';
import {
  resetSubAgentConfigCache,
  setRuntimeSubAgentOverrides,
} from '../../src/agents/sub-agent-config.ts';
import {
  resetCapabilitiesCache,
  setProviderCapabilitiesForTests,
  type ProviderCapabilities,
} from '../../src/providers/capability-probe.ts';
import {
  resetToolCallsMetaCache,
  setToolCallsMetaForTests,
} from '../../src/config/tool-calls-meta.ts';

const PROVIDER_ID = 'opencode-go-test';
const MODEL_ID = 'gpt-4o-mini';
const GEN_ID = 'gen-retry-11111111-1111-1111-1111-111111111111';

const CAPS: ProviderCapabilities = {
  schemaVersion: 1,
  probedAt: '2026-07-15T12:00:00.000Z',
  providerId: PROVIDER_ID,
  structuredOutput: true,
  structuredOutputWithTools: false,
  structuredOutputStreaming: false,
  probeError: null,
};

function proseSse(text: string): Response {
  const payload = `data: ${JSON.stringify({
    choices: [{ delta: { content: text }, finish_reason: null }],
  })}\n\ndata: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
  })}\n\nevent: end\ndata: ${JSON.stringify({ status: 'complete' })}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('sub-agent runner transient fetch retry', () => {
  const originalFetch = globalThis.fetch;
  let generationPosts = 0;
  let streamAttempts = 0;

  beforeEach(() => {
    resetSubAgentConfigCache();
    setRuntimeSubAgentOverrides(null);
    resetCapabilitiesCache();
    resetToolCallsMetaCache();
    setToolCallsMetaForTests({ useConstrainedDecoding: false });
    setProviderCapabilitiesForTests(PROVIDER_ID, CAPS);
    generationPosts = 0;
    streamAttempts = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetCapabilitiesCache();
    resetToolCallsMetaCache();
    resetSubAgentConfigCache();
    setRuntimeSubAgentOverrides(null);
  });

  test('retries work turn after Failed to fetch on generation stream subscribe', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/config/ping')) {
        return Response.json({ ok: true, home: '.minnow', homeResolved: true });
      }
      if (url.includes('/api/config/meta')) {
        return Response.json({ toolCalls: { useConstrainedDecoding: false } });
      }
      if (url.includes('/api/config/sub-agents')) {
        return Response.json({});
      }
      if (url.includes('/api/providers') && !url.includes('/capabilities')) {
        return Response.json({
          providers: [
            {
              id: PROVIDER_ID,
              label: 'OpenCode Go test',
              baseUrl: 'https://opencode.ai/zen/go',
              apiKind: 'openai-v1',
              enabled: true,
              hasApiKey: true,
              hasBearer: false,
            },
          ],
          activeProviderId: PROVIDER_ID,
        });
      }
      if (url.includes('/capabilities')) {
        return Response.json(CAPS);
      }
      if (url.includes('/api/generations') && init?.method === 'POST' && !url.includes('/stream')) {
        generationPosts += 1;
        return Response.json({ generationId: GEN_ID });
      }
      if (url.includes(GEN_ID) && url.includes('/stream')) {
        streamAttempts += 1;
        if (streamAttempts === 1) {
          throw new TypeError('Failed to fetch');
        }
        return proseSse(
          '{"summary":"Done","findings":[],"artifacts":[]}',
        );
      }

      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const out = await defaultSubAgentRunner.run({
      runId: 'run-transient-retry',
      type: 'generalPurpose',
      task: 'Say hello',
      systemPrompt: 'You are a sub-agent.',
      tools: [],
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      summarySchema: 'minnow.sub-agent.v1',
      modelContextLimit: null,
      signal: AbortSignal.timeout(15_000),
      executeTool: async () => ({ content: 'ok' }),
    });

    assert.equal(streamAttempts, 2, 'should retry stream subscribe once');
    assert.equal(generationPosts, 2, 'should create a fresh generation on retry');
    assert.equal(out.structuredOutcome?.summary, 'Done');
  });
});
